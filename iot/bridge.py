"""MQTT → Kafka ingestion bridge (the AWS IoT Core role): authenticates every device message.

Verified readings go to Kafka `telemetry.verified`; anything else goes to `telemetry.rejected`
with a reason, so the platform can show attacks instead of silently dropping them.

Run:  python -m iot.bridge
"""

import json
import time

import paho.mqtt.client as mqtt
from confluent_kafka import Producer
from confluent_kafka.admin import AdminClient, NewTopic

from . import topics
from .security import load_registry, verify


class Bridge:
    def __init__(self):
        self.registry = load_registry()
        self.last_seen: dict[str, tuple[int, int]] = {}  # device -> (boot, seq)
        self.stats = {"verified": 0, "rejected": 0}
        self.producer = Producer({"bootstrap.servers": topics.KAFKA_BOOTSTRAP, "linger.ms": 50})
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="eco-bridge")
        self.client.on_connect = lambda c, *_: c.subscribe(topics.TELEMETRY_ALL)
        self.client.on_message = self._on_message

    def _check(self, msg: dict) -> str | None:
        """Return a rejection reason, or None if the message is authentic."""
        device = self.registry.get(msg.get("device_id"))
        if device is None:
            # The simulator may have provisioned new devices since start-up
            self.registry = load_registry()
            device = self.registry.get(msg.get("device_id"))
        if device is None:
            return "unknown_device"
        if device["asset_id"] != msg.get("asset_id"):
            return "asset_mismatch"
        if not verify(device["public_key"], msg):
            return "invalid_signature"
        if (msg["boot"], msg["seq"]) <= self.last_seen.get(msg["device_id"], (0, 0)):
            return "replayed_message"
        return None

    def _on_message(self, client, userdata, mqtt_msg):
        try:
            msg = json.loads(mqtt_msg.payload)
        except json.JSONDecodeError:
            return
        try:
            reason = self._check(msg)
        except (KeyError, TypeError, AttributeError):
            reason = "malformed_message"
        key = str(msg.get("asset_id", "unknown"))
        if reason is None:
            self.last_seen[msg["device_id"]] = (msg["boot"], msg["seq"])
            self.producer.produce(topics.KAFKA_VERIFIED, key=key, value=json.dumps(msg))
            self.stats["verified"] += 1
        else:
            event = {"reason": reason, "received_at": time.time(), "message": msg}
            self.producer.produce(topics.KAFKA_REJECTED, key=key, value=json.dumps(event))
            self.stats["rejected"] += 1
            print(f"[bridge] rejected {key}: {reason}", flush=True)
        self.producer.poll(0)

    def _ensure_topics(self):
        """Create topics up front so consumers subscribed early never miss the first events."""
        admin = AdminClient({"bootstrap.servers": topics.KAFKA_BOOTSTRAP})
        existing = admin.list_topics(timeout=10).topics
        wanted = [
            NewTopic(t, num_partitions=1, replication_factor=1)
            for t in (topics.KAFKA_VERIFIED, topics.KAFKA_REJECTED)
            if t not in existing
        ]
        for future in admin.create_topics(wanted).values() if wanted else []:
            future.result()

    def run(self):
        # Kafka and MQTT may still be booting right after `docker compose up`
        for attempt in range(30):
            try:
                self._ensure_topics()
                self.client.connect(topics.MQTT_HOST, topics.MQTT_PORT)
                break
            except Exception as e:
                print(f"[bridge] waiting for infrastructure ({e.__class__.__name__}), retry {attempt + 1}", flush=True)
                time.sleep(2)
        else:
            raise SystemExit("[bridge] infrastructure not reachable")
        print(f"[bridge] {len(self.registry)} registered devices, forwarding to Kafka", flush=True)
        self.client.loop_start()
        while True:
            time.sleep(10)
            self.producer.flush(2)
            print(f"[bridge] {self.stats}", flush=True)


if __name__ == "__main__":
    Bridge().run()
