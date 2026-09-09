"""Self-check for the SCADA bridge.

Two halves:
  * `build_registers` is pure, so the mapping and the failure behaviour are
    asserted directly -- including the case that matters most, losing the
    backend, where stale values must NOT be left looking valid.
  * Then a real server is started and read over TCP with a real Modbus client,
    because "the mapping is right" and "a PLC can read it" are different claims.

Run:  .venv/Scripts/python.exe -m scada_sim.test_modbus
"""

import asyncio
import struct
import sys
import threading
import time

from pymodbus.client import ModbusTcpClient

from .modbus_server import (
    BY_NAME, DEVICE_ID, EXC_ILLEGAL_ADDRESS, EXC_ILLEGAL_FUNCTION, EXC_ILLEGAL_VALUE,
    REGISTERS,
    UNKNOWN, Bridge, build_registers,
)

HEALTH = {
    "overall": 63,
    "state": "WARNING",
    "subsystems": {"joint": 71, "bearing": 48, "alignment": 100, "belt_body": 90},
    "simulated": True,
}
RUL = {"real_world_days": 2.4}


def test_register_map_has_no_gaps_or_dupes():
    addrs = [a for a, *_ in REGISTERS]
    assert addrs == sorted(addrs), "register map out of order"
    assert len(set(addrs)) == len(addrs), "duplicate register address"
    assert addrs == list(range(len(addrs))), "register map has a hole in it"


def test_values_map_and_scale():
    r = build_registers(HEALTH, RUL, beat=7)
    assert r[BY_NAME["HEALTH_OVERALL"]] == 63
    assert r[BY_NAME["ALARM_STATE"]] == 1                  # WARNING
    assert r[BY_NAME["HEALTH_BEARING"]] == 48
    assert r[BY_NAME["RUL_DAYS"]] == 24                    # 2.4 days x10
    assert r[BY_NAME["DATA_SIMULATED"]] == 1
    assert r[BY_NAME["DATA_VALID"]] == 1
    assert r[BY_NAME["HEARTBEAT"]] == 7


def test_backend_loss_invalidates_rather_than_going_stale():
    """The failure that would actually hurt: a PLC acting on a frozen value."""
    r = build_registers(None, None, beat=3)
    assert r[BY_NAME["DATA_VALID"]] == 0
    assert r[BY_NAME["ALARM_STATE"]] == 3                  # NO_DATA
    assert r[BY_NAME["RUL_DAYS"]] == UNKNOWN
    assert r[BY_NAME["HEARTBEAT"]] == 3, "heartbeat must keep ticking; the bridge is alive"


def test_unknown_rul_is_distinct_from_zero():
    """0 days would mean 'failing now'. Unknown must not look like that."""
    r = build_registers(HEALTH, {"real_world_days": None}, beat=0)
    assert r[BY_NAME["RUL_DAYS"]] == UNKNOWN


def test_values_stay_in_16_bit_range():
    r = build_registers({"overall": 10**9, "state": "CRITICAL", "subsystems": {},
                         "simulated": False}, {"real_world_days": 10**9}, beat=99999)
    assert all(0 <= v <= 0xFFFF for v in r), r


def test_malformed_and_unsupported_requests_get_proper_exceptions():
    """A PLC must get a Modbus exception, not a dropped connection."""
    b = Bridge()
    # FC 6 (write single register) is not supported here -- read-only bridge.
    r = b.handle_pdu(DEVICE_ID, struct.pack(">BHH", 6, 0, 1))
    assert r == bytes([6 | 0x80, EXC_ILLEGAL_FUNCTION]), r
    # Reading past the end of the block -> ILLEGAL_ADDRESS. Count stays within
    # the spec's 125 limit so this exercises the address check, not the count one.
    r = b.handle_pdu(DEVICE_ID, struct.pack(">BHH", 3, 0, 100))
    assert r == bytes([3 | 0x80, EXC_ILLEGAL_ADDRESS]), r
    # Quantity above the spec limit of 125 is a VALUE error, not an address one
    # (MODBUS Application Protocol v1.1b, FC3: 0x0001 <= quantity <= 0x007D).
    r = b.handle_pdu(DEVICE_ID, struct.pack(">BHH", 3, 0, 999))
    assert r == bytes([3 | 0x80, EXC_ILLEGAL_VALUE]), r
    # Truncated PDU.
    assert b.handle_pdu(DEVICE_ID, bytes([3, 0]))[1] != 0


def test_fc3_and_fc4_return_the_same_block():
    """Some SCADA packages poll holding registers, some input registers."""
    b = Bridge()
    b.regs = build_registers(HEALTH, RUL, beat=5)
    a = b.handle_pdu(DEVICE_ID, struct.pack(">BHH", 3, 0, 6))
    c = b.handle_pdu(DEVICE_ID, struct.pack(">BHH", 4, 0, 6))
    assert a[1:] == c[1:], (a, c)


def test_a_real_modbus_client_can_read_the_registers():
    """End-to-end over TCP against pymodbus -- an independent implementation.

    "The mapping is right" and "a PLC can read it" are different claims; only
    this one supports the second.
    """
    b = Bridge()
    b.regs = build_registers(HEALTH, RUL, beat=11)

    def bg():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        async def go():
            srv = await b.serve("127.0.0.1", 5021)
            async with srv:
                await srv.serve_forever()

        loop.run_until_complete(go())

    threading.Thread(target=bg, daemon=True).start()
    time.sleep(1.5)

    client = ModbusTcpClient("127.0.0.1", port=5021)
    assert client.connect(), "could not connect to the Modbus server"
    try:
        rr = client.read_holding_registers(address=0, count=len(REGISTERS),
                                           device_id=DEVICE_ID)
        assert not rr.isError(), rr
        assert rr.registers[BY_NAME["HEALTH_OVERALL"]] == 63, rr.registers
        assert rr.registers[BY_NAME["ALARM_STATE"]] == 1, rr.registers
        assert rr.registers[BY_NAME["RUL_DAYS"]] == 24, rr.registers
        assert rr.registers[BY_NAME["HEARTBEAT"]] == 11, rr.registers
        print(f"    pymodbus read over TCP: {rr.registers}")

        # A partial read starting mid-block must also work -- SCADA rarely
        # polls the whole map.
        rr2 = client.read_holding_registers(address=2, count=3, device_id=DEVICE_ID)
        assert rr2.registers == [71, 48, 100], rr2.registers
    finally:
        client.close()


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        fn()
        print(f"  PASS  {fn.__name__}")
    print(f"\n{len(tests)} checks passed.")
    sys.exit(0)
