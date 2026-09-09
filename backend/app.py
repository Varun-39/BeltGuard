"""FastAPI backend: MQTT ingest -> fusion -> SQLite + live WebSocket.

RATE DECOUPLING (the main design decision here):

The five sensors publish at their own rates and the camera adds more on top.
Broadcasting every message straight to the browser would flood the socket and
make charts stutter, and recomputing health per message would be wasted work
since most messages change one channel slightly.

So: the MQTT thread only updates an in-memory snapshot of the newest reading
per sensor kind. A separate 2 Hz task fuses that snapshot, persists the health
row, and broadcasts one combined frame. Ingest rate and UI rate are then
independent -- a real Jetson publishing at 100 Hz would not change the frontend.

Run:  .venv/Scripts/python.exe -m uvicorn backend.app:app --port 8010
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from contextlib import asynccontextmanager, suppress

import paho.mqtt.client as mqtt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .fusion import evaluate, score
from .notify import Notifier
from .store import Store

LINE = "nmdc-line-a"
BROADCAST_HZ = 2.0
VISION_TTL_S = 5.0        # no frames for this long -> report no vision evidence
VISION_WINDOW_S = 6.0     # aggregation window for persistence
VISION_PERSISTENCE = 0.4  # a defect must appear in >=40% of recent frames to count

store = Store()
notifier = Notifier()

# Newest reading per sensor kind. Written by the MQTT thread, read by the
# broadcast task. Plain dict assignment is atomic under the GIL and we only
# ever replace whole values, so no lock is needed here.
latest: dict[str, dict] = {}
# (wall_ts, detections) for the last VISION_WINDOW_S seconds.
vision_window: deque[tuple[float, list[dict]]] = deque()
vision_simulated = True
clients: set[WebSocket] = set()
# In-flight alert-send tasks, held so the loop cannot collect them mid-send.
_pending: set[asyncio.Task] = set()
stats = {"messages": 0, "connected": False, "last_msg_ts": 0.0}


def _on_connect(client, _u, _f, rc, _p=None):
    stats["connected"] = True
    client.subscribe(f"belt/{LINE}/#", qos=0)


def _on_disconnect(*_a, **_k):
    stats["connected"] = False


def _on_message(_c, _u, msg):
    try:
        payload = json.loads(msg.payload)
    except (ValueError, UnicodeDecodeError):
        return                                  # malformed publisher; ignore, don't crash ingest
    stats["messages"] += 1
    stats["last_msg_ts"] = time.time()

    if payload.get("kind") == "vision":
        global vision_simulated
        vision_simulated = bool(payload.get("simulated", True))
        vision_window.append((payload.get("wall_ts", time.time()),
                              payload.get("values", {}).get("detections", [])))
        return

    if "kind" in payload and "values" in payload:
        latest[payload["kind"]] = payload
        store.add_reading(payload)


def _current_vision() -> dict | None:
    """Vision evidence, aggregated over a short window rather than per frame.

    TEMPORAL PERSISTENCE -- why this is not just the newest frame:

    A single frame must never drive a maintenance alarm. A camera on a
    vibrating conveyor throws false positives constantly, and belt lighting,
    ore dust and motion blur all vary frame to frame. Scoring the instantaneous
    detection made the health index flap between 13 and 100 twice a second,
    which is both useless to an operator and wrong -- a belt does not repair
    itself in 500 ms.

    So a defect must PERSIST across a meaningful fraction of recent frames
    before it counts, and its severity is the median area over those frames,
    not the worst single frame. Flicker is suppressed; a real tear, which stays
    in view as the belt runs, is not.

    The TTL still applies: with no fresh frames at all we report nothing rather
    than leaving belt_body pinned red after the camera stops.
    """
    now = time.time()
    while vision_window and now - vision_window[0][0] > VISION_WINDOW_S:
        vision_window.popleft()
    if not vision_window or now - vision_window[-1][0] > VISION_TTL_S:
        return None

    frames = len(vision_window)
    by_cls: dict[str, list[float]] = {}
    for _, dets in vision_window:
        for d in dets:
            if d.get("conf", 0) >= 0.35:
                by_cls.setdefault(d["cls"], []).append(d.get("area_frac", 0.0))

    out = []
    for cls, areas in by_cls.items():
        # Seen in too few of the recent frames -> treat as flicker, not damage.
        if frames >= 4 and len(areas) / frames < VISION_PERSISTENCE:
            continue
        areas.sort()
        out.append({
            "cls": cls,
            "conf": 0.9,
            "area_frac": areas[len(areas) // 2],      # median, not max
        })
    return {"detections": out}


def current_health() -> dict:
    snapshot = {k: v["values"] for k, v in latest.items()}
    vision = _current_vision()
    # Honest only if every contributing source says it is real.
    simulated = any(v.get("simulated", True) for v in latest.values()) or not latest
    if vision is not None:
        simulated = simulated or vision_simulated
    h = score(evaluate(snapshot, vision), simulated=simulated).to_dict()
    h["sources"] = {k: {"sensor_id": v["sensor_id"], "simulated": v["simulated"]}
                    for k, v in latest.items()}
    h["vision_active"] = vision is not None
    return h


async def _broadcast_loop() -> None:
    while True:
        await asyncio.sleep(1.0 / BROADCAST_HZ)
        if not latest:
            continue
        h = current_health()
        # Off the event loop: add_health takes the store lock and commits to
        # SQLite, and blocking I/O inside the loop stalls every socket it is
        # serving. (This was not the cause of the ~2 s request latency seen
        # during SCADA work -- that was an IPv6 `localhost` fallback -- but
        # blocking the loop on a lock a query thread may hold is still wrong.)
        await asyncio.to_thread(store.add_health, LINE, h)

        # Escalation. observe() is cheap and pure; only the SMTP round-trip
        # goes to a thread, and a failure there must not stop the broadcast.
        # The task handle is retained until it finishes: the event loop only
        # holds tasks weakly, so a bare create_task can be garbage-collected
        # mid-send (this exact bug froze the SCADA poller's heartbeat).
        if (alert := notifier.observe(h)) is not None:
            t = asyncio.create_task(asyncio.to_thread(notifier.send, alert))
            _pending.add(t)
            t.add_done_callback(_pending.discard)

        frame = json.dumps({
            "type": "tick",
            "ts": time.time(),
            "health": h,
            "readings": {k: v["values"] for k, v in latest.items()},
            "vision": _current_vision(),
        })
        for ws in list(clients):
            try:
                await ws.send_text(frame)
            except Exception:
                clients.discard(ws)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect, client.on_message = _on_connect, _on_message
    client.on_disconnect = _on_disconnect
    # Non-fatal: the API and its history endpoints stay useful with no broker,
    # and paho reconnects on its own once one appears.
    with suppress(OSError):
        client.connect_async("localhost", 1883, 60)
        client.loop_start()

    task = asyncio.create_task(_broadcast_loop())
    yield
    task.cancel()
    client.loop_stop()
    store.close()


app = FastAPI(title="Conveyor Belt Monitoring (SIH 26008)", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:3000"],
    allow_methods=["*"], allow_headers=["*"],
)


@app.get("/api/status")
def status():
    """System status -- including, explicitly, what is simulated."""
    return {
        "broker_connected": stats["connected"],
        "messages_received": stats["messages"],
        "seconds_since_last_message": (
            round(time.time() - stats["last_msg_ts"], 1) if stats["last_msg_ts"] else None),
        "sensors_live": sorted(latest),
        "vision_active": _current_vision() is not None,
        "all_data_simulated": all(v.get("simulated", True) for v in latest.values()) if latest else True,
    }


@app.get("/api/health/current")
def health_current():
    return current_health() if latest else {"state": "NO_DATA", "overall": None}


@app.get("/api/health/history")
def health_history(minutes: float = 30):
    return store.health_history(minutes)


@app.get("/api/history/{kind}")
def history(kind: str, minutes: float = 30):
    return store.history(kind, minutes)


@app.get("/api/alerts")
def alerts():
    """Recent escalations, and whether they were actually delivered."""
    return {
        "smtp_configured": notifier.configured,
        "recipients": notifier.to if notifier.configured else [],
        "current_state": notifier.confirmed,
        "alerts": [
            {"ts": a.ts, "from": a.from_state, "to": a.to_state, "health": a.health,
             "subject": a.subject, "reasons": a.reasons,
             "notified": a.notified, "delivered": a.delivered}
            for a in reversed(notifier.log)
        ],
    }


@app.get("/api/rul")
def rul(minutes: float = 30):
    """Remaining-useful-life projection from the stored health trend.

    Computed on demand rather than in the broadcast loop: it needs history, not
    the latest sample, and at 2 Hz it would be refitting the same line 120 times
    a minute to produce a number that moves on a scale of hours.
    """
    import numpy as np

    from predictive.rul import estimate
    from sensors_sim.run import DEMO_ACCELERATION

    rows = store.health_history(minutes)
    if len(rows) < 12:
        return {"confidence": "none", "basis": f"only {len(rows)} health samples so far",
                "hours_to_critical": None, "real_world_days": None}

    e = estimate(np.array([r["ts"] for r in rows]),
                 np.array([r["overall"] for r in rows])).to_dict()
    # The scenario's fault ramp is accelerated; report the field equivalent too
    # so nobody reads "0.04 h" as a claim that belts fail in minutes.
    h = e["hours_to_critical"]
    e["demo_acceleration"] = round(DEMO_ACCELERATION)
    e["real_world_days"] = round(h * DEMO_ACCELERATION / 24, 1) if h else None
    return e


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    try:
        while True:
            await ws.receive_text()     # client keepalive; frames are server-pushed
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)
