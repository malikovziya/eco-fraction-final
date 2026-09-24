"""Training data: months of simulated operation per asset with labeled fault episodes.

Uses the exact physics and fault code of the live IoT simulator, but with different random
seeds, so the model is evaluated on data it has never seen.
"""

import random
from datetime import datetime, timedelta

import numpy as np

from iot.assets import ASSETS
from iot.simulator import BAKU, Device

from .features import CLASSES, FeatureState

STEP_S = 300  # 5-minute readings, same as the live demo
EPISODES = {  # fault -> (start probability per step, min hours, max hours)
    "inflate": (0.0015, 2, 12),
    "flatline": (0.0015, 1, 8),
    "degrade": (0.0006, 24, 72),
}


def generate(days: int = 90, seed: int = 1000):
    """Returns X (features), y (class index), day index per row, and hourly true ratios per asset."""
    rng = random.Random(seed)
    X, y, day_idx = [], [], []
    hourly: dict[str, list[tuple[datetime, float]]] = {}
    start = datetime(2026, 3, 1, tzinfo=BAKU)
    steps = days * 86400 // STEP_S

    for i, asset in enumerate(ASSETS):
        device = Device(asset, key=None, seed=seed + i)
        state = FeatureState()
        active: str | None = None
        remaining = 0
        hour_energy, hour_start = 0.0, start
        series = []

        for k in range(steps):
            ts = start + timedelta(seconds=STEP_S * (k + 1))
            if active is None:
                for fault, (p, lo, hi) in EPISODES.items():
                    if rng.random() < p:
                        active, remaining = fault, rng.randint(lo, hi) * 3600 // STEP_S
                        device.set_fault(fault, True)
                        break
            elif remaining <= 0:
                device.set_fault(active, False)
                active = None
            remaining -= 1

            true = device.model.step(ts, STEP_S)
            reported = device.apply_faults(true, STEP_S)
            X.append(state.extract(asset, reported, ts))
            y.append(CLASSES.index(_label(active, true, reported, device, asset.capacity_kw)))
            day_idx.append(k * STEP_S // 86400)

            hour_energy += true["power_kw"] * STEP_S / 3600
            if ts - hour_start >= timedelta(hours=1):
                series.append((hour_start, hour_energy / asset.capacity_kw))
                hour_energy, hour_start = 0.0, ts
        hourly[asset.id] = series

    return np.array(X, dtype=np.float32), np.array(y), np.array(day_idx), hourly


def _label(active, true, reported, device, cap) -> str:
    """Label only what is actually observable: a fault that doesn't change the reading is normal."""
    diff = abs(reported["power_kw"] - true["power_kw"]) / cap
    if active == "inflate" and diff > 0.01:
        return "inflate"
    if active == "flatline" and diff > 0.02:
        return "flatline"
    if active == "degrade" and device.degradation < 0.93 and true["power_kw"] / cap > 0.03:
        return "degrade"
    return "normal"
