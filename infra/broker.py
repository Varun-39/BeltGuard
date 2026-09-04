"""MQTT broker for the demo.

WHY NOT MOSQUITTO-IN-DOCKER (the original plan):
Docker Desktop on Windows needs WSL2, which is not installed on the dev machine
and costs an admin install plus a reboot -- a heavy OS dependency to acquire for
one broker, and one every teammate and judge would have to acquire too.

amqtt is a pure-Python MQTT 3.1.1 broker, so `pip install -r requirements.txt`
is now the entire setup for the whole system. Nothing about the architecture
changes: the publishers, topics, payloads and the subscriber are unchanged, and
a real deployment would still point at a site Mosquitto by editing one host.

Run:  .venv/Scripts/python.exe infra/broker.py
"""

import anyio
from amqtt.broker import Broker

# amqtt 0.12 parses this dict into dataclasses, so keys are underscored
# (max_connections, topic_check) -- the hyphenated keys from older amqtt docs
# raise dacite.UnexpectedDataError.
CONFIG = {
    "listeners": {
        "default": {"type": "tcp", "bind": "0.0.0.0:1883", "max_connections": 100},
    },
    # Anonymous is fine on a laptop-local bind. A site deployment uses
    # per-device credentials and TLS on 8883.
    "auth": {"allow_anonymous": True},
    "topic_check": {"enabled": False},
}


async def main() -> None:
    broker = Broker(CONFIG)
    await broker.start()
    print("MQTT broker listening on tcp://0.0.0.0:1883  (Ctrl+C to stop)")
    try:
        await anyio.sleep_forever()
    finally:
        await broker.shutdown()


if __name__ == "__main__":
    try:
        anyio.run(main)
    except KeyboardInterrupt:
        print("\nbroker stopped")
