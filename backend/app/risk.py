"""AI risk engine: one live risk level per asset from three signals the platform already measures.

  1. Fraud signal       XGBoost verdicts: revenue in escrow now, or flagged hours in the last 24 h
  2. Forecast deviation LSTM: energy reported over the last 24 h vs. what the model predicted one
                        hour ahead for each of those hours; plus the XGBoost wear detector
  3. Data trust         forged-device messages rejected at the bridge in the last 24 h

Normal forecast bands were calibrated offline (backend/scripts/calibrate_risk.py) on 40 simulated
days of normal operation with seeds unseen in training: over 24 h, solar stayed within -18%..+12%
of forecast and wind within -26%..+22% (1st-99th percentile). Degradation drifted to -44%..-58%
(solar) and -27%..-68% (wind); an inflating meter to +111% (solar) and +32% (wind) or more.
"""

from datetime import datetime, timedelta

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from iot.assets import Asset

from .db import Alert, Batch, ForecastLog, HourlyEnergy, Rejection

WINDOW_H = 24
BAND = {"solar": 0.20, "wind": 0.30}  # normal |gap| (from calibration)
SEVERE = {"solar": 0.35, "wind": 0.45}  # well outside anything seen in normal operation
MIN_FORECAST_RATIO = 0.2  # 24 h forecast below 0.2 full-load hours: too little energy to judge
MAX = {"fraud": 45, "performance": 35, "data": 20}


def level(score: int) -> str:
    return "high" if score >= 45 else "medium" if score >= 20 else "low"


def _reason(en: str, tr: str) -> dict:
    return {"en": en, "tr": tr}


def score_risk(s: Session, asset: Asset) -> dict:
    reasons: list[dict] = []

    # ── 1. Fraud signal (XGBoost) ───────────────────────────────────────────
    recent = s.scalars(select(Batch).where(Batch.asset_id == asset.id).order_by(desc(Batch.id)).limit(WINDOW_H)).all()
    flagged = sum(b.flagged for b in recent)
    # Flagged and not yet decided by the multisig (in escrow, or still being settled)
    held = sum(b.flagged and b.status not in ("released", "refunded") for b in recent)
    if held:
        fraud = MAX["fraud"]
        reasons.append(_reason(f"{held} hour(s) of revenue held back after the AI flagged manipulation",
                               f"YZ manipülasyon tespit ettiği için {held} saatlik gelir bekletiliyor"))
    elif flagged:
        fraud = 25
        reasons.append(_reason(f"{flagged} flagged hour(s) in the last 24 h (resolved by the multisig)",
                               f"Son 24 saatte {flagged} işaretli saat (çoklu imza ile sonuçlandı)"))
    else:
        fraud = 0

    # ── 2. Forecast deviation (LSTM) + wear detector (XGBoost) ──────────────
    pairs = s.execute(
        select(HourlyEnergy.hour, HourlyEnergy.energy_kwh, ForecastLog.predicted_kwh)
        .join(ForecastLog, (ForecastLog.asset_id == HourlyEnergy.asset_id) & (ForecastLog.hour == HourlyEnergy.hour))
        .where(HourlyEnergy.asset_id == asset.id, HourlyEnergy.backfilled.is_(False))
        .order_by(desc(HourlyEnergy.hour)).limit(WINDOW_H)
    ).all()
    actual = sum(p.energy_kwh for p in pairs)
    predicted = sum(p.predicted_kwh for p in pairs)
    forecast = {"hours": len(pairs), "window_h": WINDOW_H, "actual_mwh": round(actual / 1000, 1),
                "forecast_mwh": round(predicted / 1000, 1), "gap": None, "band": BAND[asset.kind],
                "status": "calibrating" if len(pairs) < WINDOW_H else "ok"}
    performance = 0
    if forecast["status"] == "ok" and predicted / asset.capacity_kw < MIN_FORECAST_RATIO:
        forecast["status"] = "low_output"  # e.g. a calm day: too little energy for a fair comparison
    elif forecast["status"] == "ok":
        gap = (actual - predicted) / predicted
        forecast["gap"] = round(gap, 3)
        if abs(gap) > BAND[asset.kind]:
            performance = MAX["performance"] if abs(gap) > SEVERE[asset.kind] else 20
            if gap < 0:
                reasons.append(_reason(f"Output {abs(gap):.0%} below the AI forecast over 24 h: possible equipment wear",
                                       f"Üretim 24 saatte YZ tahmininin %{abs(gap) * 100:.0f} altında: olası ekipman yıpranması"))
            else:
                reasons.append(_reason(f"Output {gap:.0%} above the AI forecast over 24 h: possible meter inflation",
                                       f"Üretim 24 saatte YZ tahmininin %{gap * 100:.0f} üstünde: olası sayaç şişirmesi"))
    wear = s.scalar(select(Alert.id).where(Alert.asset_id == asset.id, Alert.kind == "maintenance", Alert.active))
    if wear:
        performance = max(performance, 20)
        reasons.append(_reason("AI detected output degradation (maintenance alert open)",
                               "YZ performans düşüşü tespit etti (açık bakım uyarısı)"))

    # ── 3. Data trust (device signatures) ───────────────────────────────────
    latest = s.scalar(select(func.max(HourlyEnergy.hour)).where(HourlyEnergy.asset_id == asset.id))
    rejected = 0
    if latest:
        cutoff = (datetime.fromisoformat(latest) - timedelta(hours=WINDOW_H - 1)).isoformat(timespec="seconds")
        rejected = s.scalar(select(func.count()).select_from(Rejection).where(
            Rejection.asset_id == asset.id, Rejection.ts >= cutoff)) or 0
    data = MAX["data"] if rejected >= 12 else 10 if rejected else 0
    if rejected:
        reasons.append(_reason(f"{rejected} forged-device message(s) blocked in the last 24 h",
                               f"Son 24 saatte {rejected} sahte cihaz mesajı engellendi"))

    total = fraud + performance + data
    return {
        "score": total, "level": level(total), "reasons": reasons, "forecast": forecast,
        "components": {
            "fraud": {"points": fraud, "max": MAX["fraud"], "held_hours": held, "flagged_hours": flagged},
            "performance": {"points": performance, "max": MAX["performance"], "maintenance_alert": bool(wear)},
            "data": {"points": data, "max": MAX["data"], "rejected_messages": rejected},
        },
    }
