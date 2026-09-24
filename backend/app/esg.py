"""Transparent ESG scoring. Every number is either measured live or a declared static input,
and the response carries the full breakdown so judges can see exactly how a score is built."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from iot.assets import Asset

from .config import GRID_CO2_KG_PER_KWH, HOUSEHOLD_KWH_PER_YEAR
from .db import Batch, HourlyEnergy, Reading, Rejection

WEIGHTS = {"E": 0.4, "S": 0.2, "G": 0.4}
BENCHMARK_CF = {"solar": 0.17, "wind": 0.35}  # typical capacity factors in Azerbaijan


def rating(score: float) -> str:
    for threshold, grade in ((90, "A+"), (80, "A"), (70, "B"), (55, "C")):
        if score >= threshold:
            return grade
    return "D"


def score_asset(s: Session, asset: Asset, social: dict) -> dict:
    # ── E: clean generation performance ─────────────────────────────────────
    recent = s.scalars(
        select(HourlyEnergy).where(HourlyEnergy.asset_id == asset.id).order_by(HourlyEnergy.hour.desc()).limit(24)
    ).all()
    cf = sum(h.ratio for h in recent) / len(recent) if recent else 0.0
    performance = min(1.2, cf / BENCHMARK_CF[asset.kind])
    e_score = 50 + 50 * min(1.0, performance)  # 50 for zero-emission generation itself

    live_kwh = s.scalar(select(func.sum(Batch.energy_wh)).where(Batch.asset_id == asset.id,
                                                                  Batch.status.in_(("distributed", "released")))) or 0
    live_kwh /= 1000
    co2_t = live_kwh * GRID_CO2_KG_PER_KWH / 1000
    annual_kwh = cf * asset.capacity_kw * 8760

    # ── S: local social impact (declared by the producer, audited annually) ─
    jobs_per_mw = social["jobs"] / (asset.capacity_kw / 1000)
    s_score = 40 + 30 * social["local_hiring_pct"] / 100 + 30 * min(1.0, jobs_per_mw)

    # ── G: data integrity and controls ──────────────────────────────────────
    verified = s.scalar(select(func.count()).select_from(Reading).where(Reading.asset_id == asset.id)) or 0
    rejected = s.scalar(select(func.count()).select_from(Rejection).where(Rejection.asset_id == asset.id)) or 0
    integrity = verified / (verified + rejected) if verified + rejected else 1.0
    batches = s.scalar(select(func.count()).select_from(Batch).where(Batch.asset_id == asset.id)) or 0
    flagged = s.scalar(select(func.count()).select_from(Batch).where(Batch.asset_id == asset.id, Batch.flagged)) or 0
    anomaly_rate = flagged / batches if batches else 0.0
    controls = {
        "device_signatures": True,  # Ed25519 per sensor
        "on_chain_anchoring": True,  # every batch hashed onto the EnergyOracle
        "multisig_treasury": True,  # 2-of-3 approval for escrow and admin actions
        "kyc_whitelist": True,  # shares move only between verified wallets
    }
    g_score = 40 * integrity + 40 * max(0.0, 1 - 3 * anomaly_rate) + 20 * (sum(controls.values()) / len(controls))

    total = WEIGHTS["E"] * e_score + WEIGHTS["S"] * s_score + WEIGHTS["G"] * g_score
    return {
        "score": round(total, 1),
        "rating": rating(total),
        "weights": WEIGHTS,
        "pillars": {
            "E": {
                "score": round(e_score, 1),
                "capacity_factor_24h": round(cf, 4),
                "benchmark_capacity_factor": BENCHMARK_CF[asset.kind],
                "performance_vs_benchmark": round(performance, 3),
                "co2_avoided_t": round(co2_t, 2),
                "co2_avoided_annual_t": round(annual_kwh * GRID_CO2_KG_PER_KWH / 1000),
                "households_powered": round(annual_kwh / HOUSEHOLD_KWH_PER_YEAR),
                "grid_emission_factor_kg_kwh": GRID_CO2_KG_PER_KWH,
            },
            "S": {
                "score": round(s_score, 1),
                "jobs": social["jobs"],
                "jobs_per_mw": round(jobs_per_mw, 2),
                "local_hiring_pct": social["local_hiring_pct"],
                "community_program": social["community"],
                "community_program_tr": social.get("community_tr", social["community"]),
                "source": "declared by producer",
            },
            "G": {
                "score": round(g_score, 1),
                "data_integrity": round(integrity, 4),
                "verified_readings": verified,
                "rejected_messages": rejected,
                "batches": batches,
                "flagged_batches": flagged,
                "anomaly_rate": round(anomaly_rate, 4),
                "controls": controls,
            },
        },
    }
