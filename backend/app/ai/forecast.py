"""LSTM production forecaster: next 24 hours of output from the last 48 hours.

One model per technology. The LSTM encodes recent history; the head also sees the known
future context (clear-sky sun profile for solar, diurnal wind pattern), which is available
in advance and lets the network focus on weather persistence.
"""

import json
import math
from datetime import datetime, timedelta

import numpy as np
import torch
from torch import nn

from iot.assets import Asset
from iot.physics import solar_elevation_deg

from ..config import MODELS_DIR

HISTORY_H, HORIZON_H = 48, 24
CARD_PATH = MODELS_DIR / "forecast_card.json"


def model_path(kind: str):
    return MODELS_DIR / f"forecast_lstm_{kind}.pt"


def context(asset: Asset, hour: datetime) -> float:
    """Known-in-advance driver of output for an hour: clear-sky potential or diurnal wind."""
    if asset.kind == "solar":
        mid = hour + timedelta(minutes=30)
        el = solar_elevation_deg(asset.lat, asset.lon, mid)
        return max(0.0, math.sin(math.radians(el))) ** 1.15 if el > 0 else 0.0
    return 0.5 + 0.5 * math.sin(math.radians((hour.hour - 8) * 15))


def step_inputs(asset: Asset, hour: datetime, ratio: float) -> list[float]:
    angle = 2 * math.pi * hour.hour / 24
    return [ratio, math.sin(angle), math.cos(angle), context(asset, hour)]


class Forecaster(nn.Module):
    def __init__(self, kind: str, n_inputs: int = 4, hidden: int = 64):
        super().__init__()
        # Solar has a physics prior: output = clear-sky potential x learned clearness (0..1),
        # so nights are exactly zero and the network only has to learn the weather.
        self.physics_prior = kind == "solar"
        self.lstm = nn.LSTM(n_inputs, hidden, num_layers=2, batch_first=True, dropout=0.1)
        self.head = nn.Sequential(nn.Linear(hidden + HORIZON_H, 128), nn.ReLU(), nn.Linear(128, HORIZON_H))

    def forward(self, history: torch.Tensor, future_ctx: torch.Tensor) -> torch.Tensor:
        _, (h, _) = self.lstm(history)
        out = torch.sigmoid(self.head(torch.cat([h[-1], future_ctx], dim=1)))
        return out * future_ctx if self.physics_prior else out


def windows(asset: Asset, series: list[tuple[datetime, float]]):
    hours = [h for h, _ in series]
    ratios = [r for _, r in series]
    X, C, Y = [], [], []
    for t in range(HISTORY_H, len(series) - HORIZON_H):
        X.append([step_inputs(asset, hours[j], ratios[j]) for j in range(t - HISTORY_H, t)])
        C.append([context(asset, hours[j]) for j in range(t, t + HORIZON_H)])
        Y.append(ratios[t:t + HORIZON_H])
    return X, C, Y


def train(assets: list[Asset], hourly: dict[str, list], epochs: int = 30) -> dict:
    torch.manual_seed(0)
    card = {"model": "2-layer LSTM (64 units) + future-context head (solar: physics-informed clear-sky prior)", "history_h": HISTORY_H,
            "horizon_h": HORIZON_H, "kinds": {}}
    for kind in ("solar", "wind"):
        tr, te = ([], [], []), ([], [], [])
        for a in (a for a in assets if a.kind == kind):
            X, C, Y = windows(a, hourly[a.id])
            cut = int(len(X) * 0.8)  # time-based split per asset
            for dst, sl in ((tr, slice(0, cut)), (te, slice(cut, None))):
                dst[0].extend(X[sl]); dst[1].extend(C[sl]); dst[2].extend(Y[sl])
        Xtr, Ctr, Ytr = (torch.tensor(np.array(v), dtype=torch.float32) for v in tr)
        Xte, Cte, Yte = (torch.tensor(np.array(v), dtype=torch.float32) for v in te)

        model = Forecaster(kind)
        opt = torch.optim.Adam(model.parameters(), lr=2e-3)
        loss_fn = nn.MSELoss()
        for _ in range(epochs):
            model.train()
            perm = torch.randperm(len(Xtr))
            for i in range(0, len(Xtr), 128):
                idx = perm[i:i + 128]
                opt.zero_grad()
                loss = loss_fn(model(Xtr[idx], Ctr[idx]), Ytr[idx])
                loss.backward()
                opt.step()
        model.eval()
        with torch.no_grad():
            pred = model(Xte, Cte)
        mae = float((pred - Yte).abs().mean())
        # Baseline: tomorrow looks exactly like the last 24 hours (persistence)
        persistence = Xte[:, -HORIZON_H:, 0]
        mae_base = float((persistence - Yte).abs().mean())
        torch.save(model.state_dict(), model_path(kind))
        card["kinds"][kind] = {
            "train_windows": len(Xtr), "test_windows": len(Xte),
            "mae_capacity_ratio": round(mae, 4), "persistence_mae": round(mae_base, 4),
            "improvement_vs_persistence": round(1 - mae / mae_base, 3),
        }
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card


class ForecastService:
    def __init__(self):
        self.models = {}
        for kind in ("solar", "wind"):
            m = Forecaster(kind)
            m.load_state_dict(torch.load(model_path(kind), weights_only=True))
            m.eval()
            self.models[kind] = m
        self.card = json.loads(CARD_PATH.read_text())

    def forecast(self, asset: Asset, history: list[tuple[datetime, float]]) -> list[dict]:
        """history: the last 48 (hour_start, ratio) pairs, oldest first."""
        history = history[-HISTORY_H:]
        if len(history) < HISTORY_H:
            return []
        x = torch.tensor([[step_inputs(asset, h, r) for h, r in history]], dtype=torch.float32)
        start = history[-1][0] + timedelta(hours=1)
        hours = [start + timedelta(hours=i) for i in range(HORIZON_H)]
        c = torch.tensor([[context(asset, h) for h in hours]], dtype=torch.float32)
        with torch.no_grad():
            ratios = self.models[asset.kind](x, c)[0].tolist()
        return [
            {"hour": h.isoformat(timespec="seconds"), "ratio": round(r, 4),
             "energy_kwh": round(r * asset.capacity_kw, 1)}
            for h, r in zip(hours, ratios)
        ]
