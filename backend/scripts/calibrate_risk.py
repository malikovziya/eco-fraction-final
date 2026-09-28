"""Offline calibration of the risk engine's forecast bands (backend/app/risk.py): how far does
reported output drift from the one-hour-ahead LSTM forecast over 24 h, in normal operation vs.
degradation vs. an inflating meter? Uses the live simulator's physics and faults, unseen seeds.

Run:  .venv\\Scripts\\python backend\\scripts\\calibrate_risk.py      (~30 s)
"""

import statistics
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT)]

from app.ai.forecast import ForecastService  # noqa: E402
from iot.assets import ASSETS  # noqa: E402
from iot.simulator import BAKU, Device  # noqa: E402

STEP = 300
fc = ForecastService()


def simulate(asset, seed, days, fault=None, fault_from_day=None):
    """Hourly reported capacity ratios."""
    d = Device(asset, key=None, seed=seed)
    start = datetime(2026, 9, 1, tzinfo=BAKU)
    series, e, hs = [], 0.0, start
    for k in range(days * 86400 // STEP):
        ts = start + timedelta(seconds=STEP * (k + 1))
        if fault and k * STEP // 86400 == fault_from_day and fault not in d.faults:
            d.set_fault(fault, True)
        r = d.apply_faults(d.model.step(ts, STEP), STEP)
        e += r["power_kw"] * STEP / 3600
        if ts - hs >= timedelta(hours=1):
            series.append((hs, e / asset.capacity_kw))
            e, hs = 0.0, ts
    return series


def gaps(asset, series):
    """Per hour t: (24 h reported sum, 24 h one-hour-ahead forecast sum), as capacity ratios."""
    pred = {}
    for t in range(48, len(series) - 1):
        pred[t] = fc.forecast(asset, series[t - 48:t])[0]["ratio"]  # made with history up to t-1
    out = []
    for t in range(48 + 24, len(series) - 1):
        out.append((sum(series[j][1] for j in range(t - 24, t)), sum(pred[j] for j in range(t - 24, t))))
    return out


def summary(label, rows):
    rel = sorted((a - p) / p for a, p in rows if p > 0.2)  # same low-output cut-off as the engine
    q = lambda x: rel[int(x * (len(rel) - 1))]  # noqa: E731
    print(f"{label:28s} n={len(rel):5d}  gap vs forecast: p1 {q(0.01):+.0%}  p5 {q(0.05):+.0%}  "
          f"median {statistics.median(rel):+.0%}  p95 {q(0.95):+.0%}  p99 {q(0.99):+.0%}")


for kind in ("solar", "wind"):
    normal = []
    for i, a in enumerate(x for x in ASSETS if x.kind == kind):
        normal += gaps(a, simulate(a, 7000 + i, 40))
    summary(f"{kind} normal (40 days)", normal)
    deg, inf = [], []
    for i, a in enumerate(x for x in ASSETS if x.kind == kind):
        deg += gaps(a, simulate(a, 8000 + i, 8, fault="degrade", fault_from_day=3))[-48:]  # well under way
        inf += gaps(a, simulate(a, 9000 + i, 5, fault="inflate", fault_from_day=3))[-24:]
    summary(f"{kind} degrading (days 6-8)", deg)
    summary(f"{kind} inflated meter", inf)
