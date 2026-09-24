"""Bridge between the dashboard and the IoT simulator's MQTT control channel."""

import json

import paho.mqtt.client as mqtt

from iot import topics

from ..hub import hub
from ..state import platform


class SimControl:
    def __init__(self):
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="eco-backend")
        self.client.on_connect = lambda c, *_: c.subscribe(topics.SIM_STATUS)
        self.client.on_message = self._on_status

    def start(self) -> None:
        self.client.connect_async(topics.MQTT_HOST, topics.MQTT_PORT)
        self.client.loop_start()

    def _on_status(self, client, userdata, msg) -> None:
        status = json.loads(msg.payload)
        platform().sim_status = status
        hub.publish("sim", status)

    def send(self, cmd: dict) -> None:
        self.client.publish(topics.SIM_CONTROL, json.dumps(cmd), qos=1)


simctl = SimControl()
