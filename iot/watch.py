"""Print what reaches Kafka, for checking the pipeline by hand.

  python -m iot.watch            # follow both topics
  python -m iot.watch 15         # stop after 15 seconds
"""

import json
import sys
import time

from confluent_kafka import Consumer

from . import topics


def main(seconds: float | None) -> None:
    consumer = Consumer(
        {
            "bootstrap.servers": topics.KAFKA_BOOTSTRAP,
            "group.id": f"watch-{time.time()}",
            "auto.offset.reset": "latest",
        }
    )
    consumer.subscribe([topics.KAFKA_VERIFIED, topics.KAFKA_REJECTED])
    deadline = time.time() + seconds if seconds else None
    while deadline is None or time.time() < deadline:
        msg = consumer.poll(0.5)
        if msg is None or msg.error():
            continue
        data = json.loads(msg.value())
        if msg.topic() == topics.KAFKA_REJECTED:
            m = data["message"]
            print(f"REJECTED  {m.get('asset_id'):18} {data['reason']:18} power={m.get('power_kw')} kW")
        else:
            extra = data.get("irradiance_wm2", data.get("wind_speed_ms"))
            print(f"verified  {data['asset_id']:18} {data['ts'][11:16]}  power={data['power_kw']:>10} kW  env={extra}")
    consumer.close()


if __name__ == "__main__":
    main(float(sys.argv[1]) if len(sys.argv) > 1 else None)
