"""Physics-informed features for anomaly detection, shared by training and live scoring.

The key idea: a meter's reported power must be consistent with what its own environmental
sensors (irradiance, wind speed) and the sun's position physically allow. Fraud and broken
meters break that consistency in characteristic ways the model learns to recognize.
"""

from collections import deque
from datetime import datetime

from iot.assets import Asset
from iot.physics import WindModel, solar_elevation_deg

CLASSES = ["normal", "inflate", "flatline", "degrade"]
FRAUD_CLASSES = ("inflate", "flatline")  # untrustworthy data -> revenue escrowed

FEATURES = [
    "power_ratio",  # reported power / capacity
    "implied_ratio",  # power the environment physically allows / capacity
    "residual",  # power_ratio - implied_ratio
    "consistency",  # power_ratio / implied_ratio
    "sun_elevation",  # computed server-side from time + location (device can't fake it)
    "night_output",  # solar output while the sun is below the horizon
    "is_solar",
    "env_level",  # irradiance / 1000 or wind speed / 25
    "rolling_std",  # variability of the last 6 readings (frozen meters -> 0)
    "unchanged_count",  # consecutive identical readings
    "delta_prev",  # change since the previous reading
]

FEATURE_LABELS = {
    "power_ratio": "Reported output level",
    "implied_ratio": "Physically possible output",
    "residual": "Output above what conditions allow",
    "consistency": "Output vs. sensor-implied output",
    "sun_elevation": "Sun position",
    "night_output": "Output reported at night",
    "is_solar": "Asset type",
    "env_level": "Irradiance / wind level",
    "rolling_std": "Signal variability",
    "unchanged_count": "Identical consecutive readings",
    "delta_prev": "Change since previous reading",
}


def implied_ratio(asset: Asset, reading: dict) -> float:
    if asset.kind == "solar":
        irradiance = reading.get("irradiance_wm2", 0.0)
        derate = 1 - 0.004 * max(0.0, reading.get("temperature_c", 25.0) - 25)
        return max(0.0, irradiance / 1000 * derate * 0.97)
    return WindModel.power_fraction(reading.get("wind_speed_ms", 0.0)) * 0.97


class FeatureState:
    """Per-asset rolling context over the recent reported readings."""

    def __init__(self):
        self.recent: deque[float] = deque(maxlen=6)
        self.unchanged = 0

    def extract(self, asset: Asset, reading: dict, ts: datetime) -> list[float]:
        power_ratio = reading["power_kw"] / asset.capacity_kw
        implied = implied_ratio(asset, reading)
        elevation = solar_elevation_deg(asset.lat, asset.lon, ts) if asset.kind == "solar" else 0.0

        prev = self.recent[-1] if self.recent else power_ratio
        self.unchanged = self.unchanged + 1 if self.recent and power_ratio == prev else 0
        self.recent.append(power_ratio)
        n = len(self.recent)
        mean = sum(self.recent) / n
        std = (sum((x - mean) ** 2 for x in self.recent) / n) ** 0.5

        env = reading.get("irradiance_wm2", 0.0) / 1000 if asset.kind == "solar" else reading.get("wind_speed_ms", 0.0) / 25
        return [
            power_ratio,
            implied,
            power_ratio - implied,
            power_ratio / (implied + 0.02),
            elevation,
            1.0 if asset.kind == "solar" and elevation < 0 and power_ratio > 0.01 else 0.0,
            1.0 if asset.kind == "solar" else 0.0,
            env,
            std,
            float(min(self.unchanged, 24)),
            power_ratio - prev,
        ]
