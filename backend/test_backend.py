"""Full-stack check: broker -> simulated sensors -> backend -> REST + WebSocket.

Starts the real broker, the real publisher and the real API as separate
processes and talks to them over the network. Nothing is stubbed, so a failure
here means the demo would fail too.

Run:  .venv/Scripts/python.exe -m backend.test_backend
"""

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / ".venv" / "Scripts" / "python.exe"
API = "http://127.0.0.1:8010"   # not "localhost": ::1 fallback costs ~2 s here


def get(path: str):
    with urllib.request.urlopen(API + path, timeout=5) as r:
        return json.loads(r.read())


def wait_for(fn, what: str, tries: int = 60) -> object:
    for _ in range(tries):
        try:
            v = fn()
            if v:
                return v
        except Exception:
            pass
        time.sleep(0.5)
    raise AssertionError(f"timed out waiting for {what}")


def main() -> int:
    procs = [
        subprocess.Popen([str(PY), str(ROOT / "infra" / "broker.py")],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    ]
    time.sleep(2)
    procs += [
        subprocess.Popen([str(PY), "-m", "uvicorn", "backend.app:app",
                          "--port", "8010", "--log-level", "warning"],
                         cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
        subprocess.Popen([str(PY), "-m", "sensors_sim.run", "--speed", "120", "--tick", "0.1"],
                         cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    ]

    try:
        wait_for(lambda: get("/api/status")["broker_connected"], "broker connection")
        print("  API up, broker connected")

        st = wait_for(lambda: get("/api/status") if len(get("/api/status")["sensors_live"]) == 5
                      else None, "all 5 sensor kinds")
        print(f"  sensors live: {st['sensors_live']}")
        assert st["all_data_simulated"] is True, "simulated flag lost through the backend"

        h = wait_for(lambda: get("/api/health/current") if
                     get("/api/health/current").get("overall") is not None else None, "health")
        print(f"  health {h['overall']} {h['state']}  subsystems={h['subsystems']}")
        assert set(h["subsystems"]) == {"joint", "bearing", "alignment", "belt_body"}
        assert h["simulated"] is True

        # History must actually accumulate -- proves SQLite writes are landing.
        time.sleep(4)
        vib = get("/api/history/vibration?minutes=5")
        hh = get("/api/health/history?minutes=5")
        print(f"  stored: {len(vib)} vibration rows, {len(hh)} health rows")
        assert len(vib) > 10, f"only {len(vib)} vibration rows persisted"
        assert len(hh) > 3, f"only {len(hh)} health rows persisted"
        assert "kurtosis" in vib[-1]["values"]

        # WebSocket: the path the dashboard will actually use.
        try:
            from websockets.sync.client import connect
        except ImportError:
            print("  SKIP websocket check (pip install websockets)")
        else:
            with connect("ws://127.0.0.1:8010/ws", open_timeout=10) as ws:
                frame = json.loads(ws.recv(timeout=10))
            assert frame["type"] == "tick" and frame["health"]["overall"] is not None
            assert set(frame["readings"]) == {"vibration", "temperature", "load",
                                              "speed", "acoustic"}
            print(f"  websocket frame ok: health={frame['health']['overall']}"
                  f" readings={sorted(frame['readings'])}")

        print("\nPASS  broker -> sensors -> backend -> REST + WebSocket")
        return 0
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    sys.exit(main())
