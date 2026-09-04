"""Proves the real MQTT path works: broker + simulated publisher + subscriber.

Until this passes, the pipeline is only verified in --dry-run, which does not
exercise the network boundary that a real Jetson would sit behind.

Run:  .venv/Scripts/python.exe infra/test_mqtt_roundtrip.py
"""

import json
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / ".venv" / "Scripts" / "python.exe"


def main() -> int:
    broker = subprocess.Popen([str(PY), str(ROOT / "infra" / "broker.py")],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    seen: Counter = Counter()
    payloads: list[dict] = []

    try:
        # Give the broker a moment to bind before anyone connects.
        for _ in range(40):
            time.sleep(0.25)
            probe = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            try:
                probe.connect("localhost", 1883, 5)
                probe.disconnect()
                break
            except Exception:
                continue
        else:
            print("FAIL broker never accepted a connection")
            return 1

        def on_message(_c, _u, msg):
            seen[msg.topic.split("/")[2]] += 1
            if len(payloads) < 3:
                payloads.append(json.loads(msg.payload))

        sub = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        sub.on_message = on_message
        sub.connect("localhost", 1883, 60)
        sub.subscribe("belt/#", qos=0)
        sub.loop_start()

        pub = subprocess.Popen(
            [str(PY), "-m", "sensors_sim.run", "--speed", "60", "--tick", "0.1"],
            cwd=str(ROOT), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        time.sleep(8)
        pub.terminate()
        sub.loop_stop()

        print(f"  messages received by sensor kind: {dict(seen)}")
        assert len(seen) == 5, f"expected all 5 sensor kinds, got {sorted(seen)}"
        assert sum(seen.values()) > 50, f"only {sum(seen.values())} messages"

        p = payloads[0]
        print(f"  sample payload keys: {sorted(p)}")
        for field in ("sensor_id", "kind", "t", "values", "unit", "simulated", "line"):
            assert field in p, f"payload missing {field}"
        assert p["simulated"] is True, "simulated flag lost in transit"
        print(f"  simulated flag survives the wire: {p['simulated']}")

        print("\nPASS  broker + publisher + subscriber round-trip works")
        return 0
    finally:
        broker.terminate()


if __name__ == "__main__":
    sys.exit(main())
