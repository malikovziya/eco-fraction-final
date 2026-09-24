"""Shared MQTT / Kafka topic names and broker addresses."""

MQTT_HOST, MQTT_PORT = "127.0.0.1", 1883
KAFKA_BOOTSTRAP = "127.0.0.1:19092"

# MQTT (device side)
TELEMETRY = "ecofraction/telemetry/{asset_id}"
TELEMETRY_ALL = "ecofraction/telemetry/+"
SIM_CONTROL = "ecofraction/sim/control"
SIM_STATUS = "ecofraction/sim/status"  # retained

# Kafka (platform side)
KAFKA_VERIFIED = "telemetry.verified"
KAFKA_REJECTED = "telemetry.rejected"
