"""Command-line control for the simulator (the dashboard will send the same MQTT commands).

  python -m iot.control fault gobustan-solar inflate on
  python -m iot.control fault khizi-wind forge off
  python -m iot.control speed 1          # live time
  python -m iot.control clear
"""

import json
import sys

import paho.mqtt.publish as publish

from . import topics


def main(argv: list[str]) -> None:
    if argv[:1] == ["fault"] and len(argv) == 4:
        cmd = {"cmd": "fault", "asset": argv[1], "fault": argv[2], "on": argv[3] == "on"}
    elif argv[:1] == ["speed"] and len(argv) == 2:
        cmd = {"cmd": "speed", "value": int(argv[1])}
    elif argv == ["clear"]:
        cmd = {"cmd": "clear"}
    else:
        sys.exit(__doc__)
    publish.single(topics.SIM_CONTROL, json.dumps(cmd), hostname=topics.MQTT_HOST, port=topics.MQTT_PORT)
    print(f"sent {cmd}")


if __name__ == "__main__":
    main(sys.argv[1:])
