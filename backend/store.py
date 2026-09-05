"""Time-series persistence.

WHY SQLITE AND NOT INFLUXDB:
A demo run produces on the order of 10^5-10^6 rows. SQLite in WAL mode handles
that with an index and zero operational surface -- no container, no query
language, no retention policy, and (as the Docker/WSL episode proved) no system
dependency a teammate or judge has to acquire. A site deployment writing years
of history across dozens of conveyors would want a real TSDB; the swap is
confined to this file.

`simulated` is stored per row rather than assumed globally, so a future mixed
deployment -- real camera, simulated vibration -- stays honest at row level.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[1] / "belt.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
    ts        REAL NOT NULL,
    line      TEXT NOT NULL,
    kind      TEXT NOT NULL,
    sensor_id TEXT NOT NULL,
    values_js TEXT NOT NULL,
    simulated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_ts   ON readings(ts);
CREATE INDEX IF NOT EXISTS idx_readings_kind ON readings(kind, ts);

CREATE TABLE IF NOT EXISTS health (
    ts          REAL NOT NULL,
    line        TEXT NOT NULL,
    overall     INTEGER NOT NULL,
    state       TEXT NOT NULL,
    subsystems  TEXT NOT NULL,
    reasons     TEXT NOT NULL,
    simulated   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_ts ON health(ts);
"""


class Store:
    def __init__(self, path: Path | str = DB_PATH):
        # Three threads touch this: paho's MQTT callback thread (inserts
        # readings), the asyncio broadcast task (inserts health), and FastAPI's
        # handler threads (queries). check_same_thread=False permits that, but
        # it does NOT make the connection concurrency-safe -- interleaving
        # statements on one sqlite3 connection raises
        # "InterfaceError: bad parameter or other API misuse" mid-query, which
        # surfaced as intermittent 500s on /api/history. One lock around every
        # statement fixes it.
        # ponytail: single global lock. Demo write rate is ~10/s so contention
        # is irrelevant; a per-connection pool is the upgrade if that changes.
        self._lock = threading.Lock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")     # concurrent read + write
        self.db.execute("PRAGMA synchronous=NORMAL")   # durable enough, much faster
        self.db.executescript(SCHEMA)
        self.db.commit()

    def add_reading(self, r: dict) -> None:
        with self._lock:
            self.db.execute(
                "INSERT INTO readings VALUES (?,?,?,?,?,?)",
                (r.get("wall_ts", time.time()), r.get("line", "?"), r["kind"],
                 r["sensor_id"], json.dumps(r["values"]), int(bool(r["simulated"]))),
            )

    def add_health(self, line: str, h: dict) -> None:
        with self._lock:
            self.db.execute(
                "INSERT INTO health VALUES (?,?,?,?,?,?,?)",
                (time.time(), line, h["overall"], h["state"],
                 json.dumps(h["subsystems"]), json.dumps(h["reasons"]),
                 int(bool(h["simulated"]))),
            )
            self.db.commit()   # low-rate stream; this commit covers readings too

    def history(self, kind: str, minutes: float = 30, limit: int = 600) -> list[dict]:
        """Recent readings for one sensor kind, oldest first.

        Evenly strided down to `limit` points server-side: a 30-minute window at
        5 Hz is ~9000 rows, and sending those to a chart that renders 600 pixels
        wastes bandwidth to draw the same line.
        """
        since = time.time() - minutes * 60
        with self._lock:
            rows = self.db.execute(
                "SELECT ts, sensor_id, values_js, simulated FROM readings"
                " WHERE kind=? AND ts>=? ORDER BY ts",
                (kind, since),
            ).fetchall()
        step = max(1, len(rows) // limit)
        return [
            {"ts": ts, "sensor_id": sid, "values": json.loads(v), "simulated": bool(s)}
            for ts, sid, v, s in rows[::step]
        ]

    def health_history(self, minutes: float = 30, limit: int = 600) -> list[dict]:
        since = time.time() - minutes * 60
        with self._lock:
            rows = self.db.execute(
                "SELECT ts, overall, state, subsystems FROM health"
                " WHERE ts>=? ORDER BY ts", (since,),
            ).fetchall()
        step = max(1, len(rows) // limit)
        return [
            {"ts": ts, "overall": o, "state": st, "subsystems": json.loads(sub)}
            for ts, o, st, sub in rows[::step]
        ]

    def close(self) -> None:
        with self._lock:
            self.db.commit()
            self.db.close()
