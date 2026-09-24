"""IoT sensor simulator: one signed telemetry stream per asset over MQTT, with injectable faults.

Run:  python -m iot.simulator
Control (MQTT topic ecofraction/sim/control, JSON):
  {"cmd": "fault", "asset": "gobustan-solar", "fault": "inflate", "on": true}
  {"cmd": "speed", "value": 300}        # simulated seconds per real second (1 = live)
  {"cmd": "clear"}                      # remove all faults
"""

import json
import random
import time
from datetime import datetime, timedelta, timezone

import paho.mqtt.client as mqtt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from . import topics
from .assets import ASSETS, UTC_OFFSET_HOURS, Asset
from .physics import SolarModel, WindModel
from .security import device_id_for, load_or_create_keys, sign

FAULTS = ("inflate", "flatline", "degrade", "forge")
DEFAULT_SPEED = 300  # 1 real second = 5 simulated minutes
TICK_S = 1.0
BAKU = timezone(timedelta(hours=UTC_OFFSET_HOURS))


class Device:
    def __init__(self, asset: Asset, key: Ed25519PrivateKey, seed: int):
        self.asset = asset
        self.key = key
        self.device_id = device_id_for(asset.id)
        rng = random.Random(seed)
        self.model = SolarModel(asset, rng) if asset.kind == "solar" else WindModel(asset, rng)
        # Sequence numbers restart on reboot, so (boot, seq) identifies each message
        self.boot = int(time.time())
        self.seq = 0
        self.faults: set[str] = set()
        self.degradation = 1.0
        self.frozen: dict | None = None

    def set_fault(self, fault: str, on: bool) -> None:
        if on:
            self.faults.add(fault)
        else:
            self.faults.discard(fault)
            if fault == "degrade":
                self.degradation = 1.0
            if fault == "flatline":
                self.frozen = None

    def reading(self, sim_time: datetime, dt_s: float) -> dict:
        r = self.model.step(sim_time, dt_s)
        cap = self.asset.capacity_kw

        if "degrade" in self.faults:
            # Soiled panels / failing gearbox: output slides towards 50% over ~1.5 sim days
            self.degradation = max(0.5, self.degradation - 0.0012 * dt_s / 300)
            r["power_kw"] *= self.degradation
        if "inflate" in self.faults:
            # Fraud: meter follows the real curve but over-reports, and keeps producing at night
            r["power_kw"] = r["power_kw"] * 1.7 + cap * 0.12 * random.uniform(0.9, 1.1)
        if "flatline" in self.faults:
            self.frozen = self.frozen or dict(r)
            r = dict(self.frozen)

        r["power_kw"] = round(r["power_kw"], 2)
        return r

    def message(self, sim_time: datetime, dt_s: float) -> dict:
        r = self.reading(sim_time, dt_s)
        self.seq += 1
        payload = {
            "device_id": self.device_id,
            "asset_id": self.asset.id,
            "kind": self.asset.kind,
            "boot": self.boot,
            "seq": self.seq,
            "ts": sim_time.isoformat(timespec="seconds"),
            "interval_s": dt_s,
            "energy_kwh": round(r["power_kw"] * dt_s / 3600, 3),
            "capacity_kw": self.asset.capacity_kw,
            **r,
        }
        return sign(self.key, payload)


class Simulator:
    def __init__(self):
        keys = load_or_create_keys([a.id for a in ASSETS])
        self.devices = {
            a.id: Device(a, keys[device_id_for(a.id)], seed=i + 1) for i, a in enumerate(ASSETS)
        }
        self.attacker_key = Ed25519PrivateKey.generate()  # not in the registry
        self.speed = DEFAULT_SPEED
        # Start at 05:00 Baku time today so the demo opens on a sunrise
        now = datetime.now(BAKU)
        self.sim_time = now.replace(hour=5, minute=0, second=0, microsecond=0)

        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="eco-simulator")
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_control

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        client.subscribe(topics.SIM_CONTROL)
        self._publish_status()

    def _on_control(self, client, userdata, msg):
        try:
            cmd = json.loads(msg.payload)
            if cmd["cmd"] == "fault" and cmd["fault"] in FAULTS:
                targets = self.devices.values() if cmd["asset"] == "*" else [self.devices[cmd["asset"]]]
                for d in targets:
                    d.set_fault(cmd["fault"], bool(cmd.get("on", True)))
            elif cmd["cmd"] == "speed":
                self.speed = max(1, min(3600, int(cmd["value"])))
            elif cmd["cmd"] == "clear":
                for d in self.devices.values():
                    for f in list(d.faults):
                        d.set_fault(f, False)
            print(f"[control] {cmd}", flush=True)
        except (KeyError, ValueError, TypeError) as e:
            print(f"[control] ignored invalid command {msg.payload!r}: {e}", flush=True)
        self._publish_status()

    def _publish_status(self):
        status = {
            "sim_time": self.sim_time.isoformat(timespec="seconds"),
            "speed": self.speed,
            "faults": {aid: sorted(d.faults) for aid, d in self.devices.items() if d.faults},
            "assets": [d.asset.id for d in self.devices.values()],
        }
        self.client.publish(topics.SIM_STATUS, json.dumps(status), qos=1, retain=True)

    def _forged(self, real: dict) -> dict:
        """Attacker impersonates a real device with inflated output, signed with an unknown key."""
        fake = dict(real)
        fake["power_kw"] = round(real["capacity_kw"] * 0.95, 2)
        fake["energy_kwh"] = round(fake["power_kw"] * real["interval_s"] / 3600, 3)
        return sign(self.attacker_key, fake)

    def run(self):
        for attempt in range(30):  # broker may still be booting
            try:
                self.client.connect(topics.MQTT_HOST, topics.MQTT_PORT)
                break
            except OSError:
                print(f"[simulator] waiting for MQTT broker, retry {attempt + 1}", flush=True)
                time.sleep(2)
        else:
            raise SystemExit("[simulator] MQTT broker not reachable")
        self.client.loop_start()
        print(f"[simulator] {len(self.devices)} devices online, speed x{self.speed}", flush=True)
        while True:
            started = time.monotonic()
            dt_s = self.speed * TICK_S
            self.sim_time += timedelta(seconds=dt_s)
            for d in self.devices.values():
                topic = topics.TELEMETRY.format(asset_id=d.asset.id)
                real = d.message(self.sim_time, dt_s)
                self.client.publish(topic, json.dumps(real))
                if "forge" in d.faults:
                    self.client.publish(topic, json.dumps(self._forged(real)))
            self._publish_status()
            time.sleep(max(0.0, TICK_S - (time.monotonic() - started)))


if __name__ == "__main__":
    Simulator().run()
