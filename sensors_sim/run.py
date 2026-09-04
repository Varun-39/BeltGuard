"""Scenario runner: drives the belt simulator and publishes to MQTT.

This is the process a real Jetson Nano would replace. It publishes to the same
topics with the same payload shape that on-device sensor code would, so the
backend cannot tell the difference -- except for the `simulated` flag, which it
deliberately can.

Topic layout:  belt/<line>/<kind>/<sensor_id>

The scenario is a DEGRADATION TIMELINE, not a fault switch. Severities are
interpolated between keyframes so faults grow the way real ones do: gradually,
overlapping, with the belt still running. A step change from 0 to 1 would make
the downstream anomaly detection and RUL estimation trivially easy and
therefore meaningless.

Run:  .venv/Scripts/python.exe -m sensors_sim.run --dry-run
      .venv/Scripts/python.exe -m sensors_sim.run --speed 20
"""

from __future__ import annotations

import argparse
import json
import time

from .belt import BeltModel, default_array

LINE = "nmdc-line-a"

# (sim_seconds, {fault: severity}) -- severities ramp linearly between frames.
# Story: a bearing starts to spall, running hot; the extra vibration works the
# splice loose; tension falls and the joint approaches rupture.
SCENARIO: list[tuple[float, dict[str, float]]] = [
    (0,    {}),
    (300,  {"idler_bearing_fault": 0.20}),
    (900,  {"idler_bearing_fault": 0.45, "belt_misalignment": 0.15}),
    (1500, {"idler_bearing_fault": 0.60, "belt_misalignment": 0.30,
            "splice_degradation": 0.25}),
    (2100, {"idler_bearing_fault": 0.70, "belt_misalignment": 0.35,
            "splice_degradation": 0.55}),
    (2700, {"idler_bearing_fault": 0.75, "belt_misalignment": 0.40,
            "splice_degradation": 0.85, "belt_tear": 0.30}),
]


def severities_at(t: float) -> dict[str, float]:
    """Linear interpolation between scenario keyframes."""
    if t <= SCENARIO[0][0]:
        return dict(SCENARIO[0][1])
    if t >= SCENARIO[-1][0]:
        return dict(SCENARIO[-1][1])
    for (t0, f0), (t1, f1) in zip(SCENARIO, SCENARIO[1:]):
        if t0 <= t <= t1:
            w = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
            keys = set(f0) | set(f1)
            return {k: f0.get(k, 0.0) * (1 - w) + f1.get(k, 0.0) * w for k in keys}
    return {}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--speed", type=float, default=10.0,
                    help="sim seconds per wall second (compresses the demo)")
    ap.add_argument("--tick", type=float, default=0.5, help="wall seconds per tick")
    ap.add_argument("--dry-run", action="store_true", help="print instead of publish")
    args = ap.parse_args()

    belt = BeltModel()
    sensors = default_array(belt)

    client = None
    if not args.dry_run:
        import paho.mqtt.client as mqtt

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.connect(args.host, args.port, 60)
        client.loop_start()
        print(f"publishing to mqtt://{args.host}:{args.port} under belt/{LINE}/#")

    t = 0.0
    end = SCENARIO[-1][0]
    try:
        while t < end:
            for mode, sev in severities_at(t).items():
                belt.set_fault(mode, sev)

            for s in sensors:
                r = s.read(t)
                payload = r.to_dict() | {"line": LINE, "wall_ts": time.time()}
                topic = f"belt/{LINE}/{r.kind}/{r.sensor_id}"
                if client:
                    client.publish(topic, json.dumps(payload), qos=0)

            if args.dry_run and int(t) % 300 < args.speed * args.tick:
                sev = {k: round(v, 2) for k, v in severities_at(t).items() if v > 0.01}
                vib = sensors[0].read(t).values
                tmp = sensors[1].read(t).values
                print(f"  t={t:>6.0f}s  {str(sev):<72} "
                      f"kurt={vib['kurtosis']:>6.2f} temp={tmp['temp_c']:>5.1f}C")

            t += args.speed * args.tick
            time.sleep(args.tick)
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        if client:
            client.loop_stop()
            client.disconnect()
    print(f"scenario complete ({end:.0f} sim seconds)")


if __name__ == "__main__":
    main()
