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
from contextlib import asynccontextmanager, suppress

import paho.mqtt.client as mqtt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .fusion import evaluate, score
from .store import Store

LINE = "nmdc-line-a"
BROADCAST_HZ = 2.0
VISION_TTL_S = 5.0      # a detection older than this no longer describes the belt

store = Store()

# Newest reading per sensor kind. Written by the MQTT thread, read by the
# broadcast task. Plain dict assignment is atomic under the GIL and we only
# ever replace whole values, so no lock is needed here.
latest: dict[str, dict] = {}
latest_vision: dict = {}
clients: set[WebSocket] = set()
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
        latest_vision.clear()
        latest_vision.update(payload)
        return

    if "kind" in payload and "values" in payload:
        latest[payload["kind"]] = payload
        store.add_reading(payload)


def _current_vision() -> dict | None:
    """Vision evidence, but only while it is still fresh.

    Without the TTL a single stale detection would keep the belt_body subsystem
    pinned red forever after the camera stopped -- the dashboard would show a
    tear that is no longer in frame.
    """
    if not latest_vision:
        return None
    if time.time() - latest_vision.get("wall_ts", 0) > VISION_TTL_S:
        return None
    return latest_vision.get("values", {})


def current_health() -> dict:
    snapshot = {k: v["values"] for k, v in latest.items()}
    vision = _current_vision()
    # Honest only if every contributing source says it is real.
    simulated = any(v.get("simulated", True) for v in latest.values()) or not latest
    if vision is not None:
        simulated = simulated or bool(latest_vision.get("simulated", True))
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
        store.add_health(LINE, h)
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
