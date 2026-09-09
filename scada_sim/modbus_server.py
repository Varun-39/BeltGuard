"""Modbus/TCP bridge: exposes belt health to plant SCADA or a PLC.

WHY THIS EXISTS:

A mine already runs a SCADA system. Nobody is going to watch our dashboard
instead of the control room screen they already have -- the system has to hand
its conclusions to the existing infrastructure. Modbus/TCP is the lowest common
denominator every PLC and SCADA package speaks, so it is the honest integration
surface for a Ministry of Steel / NMDC deployment.

This is a BRIDGE, not a second source of truth: it polls the backend's fused
health and mirrors it into holding registers. Fusion, thresholds and evidence
all stay in one place.

WHY THE SERVER IS HAND-WRITTEN RATHER THAN pymodbus:

pymodbus 3.15 is mid-migration. Its `ModbusServerContext` datastore is
deprecated ("convert to SimData/SimDevice") and rejected our writes, while the
replacement `SimData` pre-builds its register block and offers no supported way
to mutate values once the server is running -- which is the entire job of a
live bridge. Modbus/TCP function code 3 is a fixed 7-byte header plus a 5-byte
request, so serving it directly is less code than working around that.

pymodbus is still used as the TEST CLIENT (see test_modbus.py). Verifying our
server against an independent, widely-used Modbus implementation is a stronger
claim than testing it against our own client.

TWO CONVENTIONS THAT MATTER TO A PLC ENGINEER:

  * Holding registers are unsigned 16-bit integers. There are no floats and no
    negatives, so physical values are scaled by a fixed factor and the factor
    is part of the register map contract (speed x100, temperature x10).
  * HEARTBEAT and DATA_VALID are separate on purpose. The heartbeat proves this
    bridge is alive; DATA_VALID proves the numbers are fresh. A bridge that is
    running but has lost the backend must not look healthy -- that is how a PLC
    ends up acting on a frozen value.

Run:  .venv/Scripts/python.exe -m scada_sim.modbus_server
"""

from __future__ import annotations

import argparse
import asyncio
import json
import urllib.error
import urllib.request

import struct

DEVICE_ID = 1          # Modbus unit/device id this bridge answers on

# Modbus exception codes (MODBUS Application Protocol v1.1b, section 7).
EXC_ILLEGAL_FUNCTION = 0x01
EXC_ILLEGAL_ADDRESS = 0x02
EXC_ILLEGAL_VALUE = 0x03

# 127.0.0.1, NOT "localhost". On this Windows host `localhost` resolves to ::1
# first while uvicorn binds IPv4 only, so every request spends ~2 s failing over
# to IPv6 before falling back: 2040 ms via localhost vs 15 ms via 127.0.0.1.
# That alone saturated this bridge's 1 s poll loop.
API = "http://127.0.0.1:8010/api"

# THE REGISTER MAP. Single source of truth: the server writes from it and
# docs/scada-register-map is generated from it, so they cannot drift apart.
# (address, name, scale, description)
REGISTERS: list[tuple[int, str, float, str]] = [
    (0,  "HEALTH_OVERALL",   1,   "Fused belt health index, 0-100"),
    (1,  "ALARM_STATE",      1,   "0=NORMAL 1=WARNING 2=CRITICAL 3=NO_DATA"),
    (2,  "HEALTH_JOINT",     1,   "Splice/joint subsystem health, 0-100"),
    (3,  "HEALTH_BEARING",   1,   "Idler bearing subsystem health, 0-100"),
    (4,  "HEALTH_ALIGNMENT", 1,   "Belt tracking subsystem health, 0-100"),
    (5,  "HEALTH_BELT_BODY", 1,   "Belt body subsystem health, 0-100"),
    (6,  "BELT_SPEED",       100, "Belt speed, m/s x100"),
    (7,  "BEARING_TEMP",     10,  "Idler bearing housing temperature, degC x10"),
    (8,  "RUL_DAYS",         10,  "Projected days to CRITICAL x10; 65535 = unknown"),
    (9,  "DATA_SIMULATED",   1,   "1 = any contributing source is simulated"),
    (10, "DATA_VALID",       1,   "1 = backend reachable and data fresh"),
    (11, "HEARTBEAT",        1,   "Increments every poll; wraps at 65535"),
]
BY_NAME = {name: addr for addr, name, _, _ in REGISTERS}

STATE_CODE = {"NORMAL": 0, "WARNING": 1, "CRITICAL": 2, "NO_DATA": 3}
UNKNOWN = 0xFFFF          # 65535: "no value", distinct from a real zero
POLL_S = 1.0


def _get(path: str, timeout: float = 3.0) -> dict | None:
    try:
        with urllib.request.urlopen(f"{API}{path}", timeout=timeout) as r:
            return json.loads(r.read())
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return None


def _clamp(v: float) -> int:
    """Modbus holding registers are unsigned 16-bit."""
    return max(0, min(0xFFFF, int(round(v))))


def build_registers(health: dict | None, rul: dict | None, beat: int) -> list[int]:
    """Map backend JSON onto the register block. Pure, so it is testable."""
    regs = [0] * len(REGISTERS)
    regs[BY_NAME["HEARTBEAT"]] = beat % 0x10000

    if not health or health.get("overall") is None:
        # Lost the backend: say so explicitly rather than leaving stale numbers
        # in place. A PLC reading DATA_VALID=0 knows to ignore the rest.
        regs[BY_NAME["ALARM_STATE"]] = STATE_CODE["NO_DATA"]
        regs[BY_NAME["DATA_VALID"]] = 0
        regs[BY_NAME["RUL_DAYS"]] = UNKNOWN
        return regs

    subs = health.get("subsystems", {})
    regs[BY_NAME["HEALTH_OVERALL"]] = _clamp(health["overall"])
    regs[BY_NAME["ALARM_STATE"]] = STATE_CODE.get(health.get("state", ""), 3)
    regs[BY_NAME["HEALTH_JOINT"]] = _clamp(subs.get("joint", 0))
    regs[BY_NAME["HEALTH_BEARING"]] = _clamp(subs.get("bearing", 0))
    regs[BY_NAME["HEALTH_ALIGNMENT"]] = _clamp(subs.get("alignment", 0))
    regs[BY_NAME["HEALTH_BELT_BODY"]] = _clamp(subs.get("belt_body", 0))
    regs[BY_NAME["DATA_SIMULATED"]] = 1 if health.get("simulated", True) else 0
    regs[BY_NAME["DATA_VALID"]] = 1

    days = (rul or {}).get("real_world_days")
    regs[BY_NAME["RUL_DAYS"]] = UNKNOWN if days is None else _clamp(days * 10)
    return regs


def _latest_readings() -> dict:
    """Speed and bearing temperature, straight off the history endpoint."""
    out = {}
    for kind, key in (("speed", "speed_mps"), ("temperature", "temp_c")):
        rows = _get(f"/history/{kind}?minutes=2")
        if rows:
            out[key] = rows[-1]["values"].get(key, 0.0)
    return out


class Bridge:
    """Holds the register block and serves it over Modbus/TCP."""

    def __init__(self) -> None:
        self.regs: list[int] = build_registers(None, None, 0)

    # -- polling -----------------------------------------------------------

    async def updater(self) -> None:
        """Poll the backend and mirror it into the register block.

        The HTTP calls are blocking, so they run in threads rather than stalling
        the event loop -- a Modbus server that stops answering while it waits on
        an API is worse than one serving data a second old.
        """
        beat = 0
        while True:
            try:
                health, rul, latest = await asyncio.gather(
                    asyncio.to_thread(_get, "/health/current"),
                    asyncio.to_thread(_get, "/rul?minutes=30"),
                    asyncio.to_thread(_latest_readings),
                )
                regs = build_registers(health, rul, beat)
                if health and health.get("overall") is not None:
                    regs[BY_NAME["BELT_SPEED"]] = _clamp(latest.get("speed_mps", 0) * 100)
                    regs[BY_NAME["BEARING_TEMP"]] = _clamp(latest.get("temp_c", 0) * 10)
            except Exception as exc:
                # This loop must never die: a bridge that silently stops polling
                # keeps serving its last values, and a PLC has no way to tell.
                # Fail to NO_DATA/DATA_VALID=0 instead and keep the beat going.
                print(f"  poll failed ({type(exc).__name__}: {exc}); reporting NO_DATA")
                regs = build_registers(None, None, beat)

            # Single assignment, so a reader never sees a half-updated block.
            self.regs = regs
            beat += 1
            await asyncio.sleep(POLL_S)

    # -- protocol ----------------------------------------------------------

    def handle_pdu(self, unit: int, pdu: bytes) -> bytes:
        """One Modbus request PDU -> one response PDU.

        Supports FC3 (read holding registers) and FC4 (read input registers),
        which return the same block: some SCADA packages poll one, some the
        other, and refusing FC4 would fail an integration for no reason.
        """
        if len(pdu) < 5:
            return bytes([0x80, EXC_ILLEGAL_VALUE])
        fc, start, count = struct.unpack(">BHH", pdu[:5])
        if fc not in (3, 4):
            return bytes([fc | 0x80, EXC_ILLEGAL_FUNCTION])
        if not 1 <= count <= 125:                       # spec limit for FC3/4
            return bytes([fc | 0x80, EXC_ILLEGAL_VALUE])
        if start + count > len(self.regs):
            return bytes([fc | 0x80, EXC_ILLEGAL_ADDRESS])

        regs = self.regs[start:start + count]
        return struct.pack(">BB", fc, 2 * count) + b"".join(
            struct.pack(">H", v) for v in regs
        )

    async def _client(self, reader: asyncio.StreamReader,
                      writer: asyncio.StreamWriter) -> None:
        try:
            while True:
                # MBAP header: transaction id, protocol id, length, unit id.
                header = await reader.readexactly(7)
                txn, proto, length, unit = struct.unpack(">HHHB", header)
                if proto != 0:                          # 0 == Modbus
                    break
                pdu = await reader.readexactly(max(length - 1, 0))
                resp = self.handle_pdu(unit, pdu)
                writer.write(struct.pack(">HHHB", txn, 0, len(resp) + 1, unit) + resp)
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionResetError):
            pass                                        # client hung up; normal
        finally:
            writer.close()

    async def serve(self, host: str, port: int) -> asyncio.Server:
        return await asyncio.start_server(self._client, host, port)


def print_map() -> None:
    for addr, name, scale, desc in REGISTERS:
        sc = "" if scale == 1 else f"  [x{scale:g}]"
        print(f"  {addr:>2}  {name:<17} {desc}{sc}")


async def serve(host: str, port: int) -> None:
    bridge = Bridge()
    # Keep a reference. A bare `asyncio.create_task(...)` is only weakly held by
    # the loop, so the poller can be garbage-collected mid-run -- which is
    # exactly what happened here: the heartbeat froze while the server kept
    # cheerfully serving stale registers.
    poller = asyncio.create_task(bridge.updater())
    try:
        server = await bridge.serve(host, port)
        async with server:
            await server.serve_forever()
    finally:
        poller.cancel()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=5020)   # 502 needs root/admin
    args = ap.parse_args()

    print(f"Modbus/TCP server on {args.host}:{args.port}  (device id {DEVICE_ID})")
    print(f"  mirroring {API} into {len(REGISTERS)} holding registers\n")
    print_map()
    print("\nCtrl+C to stop")
    try:
        asyncio.run(serve(args.host, args.port))
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
