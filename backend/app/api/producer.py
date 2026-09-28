"""Producer (B2B) dashboard, ESG/risk report data, and platform economics."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..chain import chain, from_usdc
from ..config import GRID_CO2_KG_PER_KWH
from ..db import Activity, Alert, Batch, HourlyEnergy, Rejection, Trade, User
from ..esg import BENCHMARK_CF, score_asset
from ..risk import score_risk
from ..state import platform
from .deps import current_user, get_db, require_role

router = APIRouter(prefix="/api")

# B2B SaaS plans (business model 4.3 #2). Producers' current plans are demo contracts.
PLANS = {
    "Basic": {"price_month": 0, "features": ["listing", "live_monitoring"]},
    "Pro": {"price_month": 490, "features": ["listing", "live_monitoring", "esg_reports", "risk_reports", "forecast"]},
    "Enterprise": {"price_month": 1900, "features": ["listing", "live_monitoring", "esg_reports", "risk_reports",
                                                     "forecast", "api_access", "white_label"]},
}
PRODUCER_PLANS = {"solar": "Pro", "wind": "Enterprise"}
# Institutional investors subscribe for ESG and risk reports on the assets they hold (demo contract)
INSTITUTIONAL_PLAN = "Pro"
INSTITUTIONAL_TITLE = "Institutional investor"


def is_institutional(user: User) -> bool:
    return user.role == "investor" and user.title == INSTITUTIONAL_TITLE
# Third-party pipeline for the ESG-verification licence (business model 4.3 #3), clearly marked as pipeline
LICENSING_PIPELINE = [
    {"client": "Regional utility (pilot)", "stage": "pilot", "annual_usd": 36_000},
    {"client": "Green bond issuer", "stage": "negotiation", "annual_usd": 60_000},
]
CARBON_PRICE_USD_T = 12  # voluntary-market reference price for the future carbon-credit module
CARBON_PLATFORM_SHARE = 0.05


def _producer_key(user: User) -> str:
    accounts = chain().deployment["accounts"]
    for key, role in (("solar", "solarProducer"), ("wind", "windProducer")):
        if accounts[role]["address"].lower() == user.wallet_address.lower():
            return key
    raise HTTPException(403, "Not a registered producer")


def _asset_ops(s: Session, asset) -> dict:
    info = next(a for a in chain().deployment["assets"] if a["id"] == asset.id)
    raised = s.scalar(select(func.sum(Activity.amount_usdc)).where(
        Activity.kind == "buy", Activity.asset_id == asset.id)) or 0.0
    investors = s.scalar(select(func.count(func.distinct(Activity.user_id))).where(
        Activity.kind == "buy", Activity.asset_id == asset.id)) or 0
    last24 = s.scalars(select(HourlyEnergy).where(HourlyEnergy.asset_id == asset.id)
                       .order_by(desc(HourlyEnergy.hour)).limit(24)).all()
    energy24 = sum(h.energy_kwh for h in last24)
    cf = sum(h.ratio for h in last24) / len(last24) if last24 else 0.0
    batches24 = s.scalars(select(Batch).where(Batch.asset_id == asset.id).order_by(desc(Batch.id)).limit(24)).all()
    revenue24 = sum(b.revenue_usdc or 0 for b in batches24 if b.status in ("distributed", "released"))
    escrowed = [b.id for b in batches24 if b.status == "escrowed"]
    alerts = s.scalars(select(Alert).where(Alert.asset_id == asset.id, Alert.active)).all()
    forecast = platform().forecasts.get(asset.id, [])
    esg = score_asset(s, asset, platform().social[asset.id])
    return {
        "asset_id": asset.id, "name": asset.name, "kind": asset.kind, "capacity_kw": asset.capacity_kw,
        "raised_usdc": round(raised * 0.99, 2),  # net of the 1% platform fee
        "offered_usdc": info["offeredShares"] * 10, "investors": investors,
        "energy_24h_kwh": round(energy24, 1), "capacity_factor_24h": round(cf, 4),
        "performance_ratio": round(cf / BENCHMARK_CF[asset.kind], 3),
        "revenue_24h_usdc": round(revenue24, 2), "escrowed_batches": escrowed,
        "forecast_next_24h_kwh": round(sum(f["energy_kwh"] for f in forecast), 1),
        "alerts": [{"id": a.id, "kind": a.kind, "severity": a.severity, "title": a.title, "detail": a.detail,
                    "title_tr": a.title_tr, "detail_tr": a.detail_tr} for a in alerts],
        "esg": {"score": esg["score"], "rating": esg["rating"]},
    }


@router.get("/producer/overview")
def overview(user: User = Depends(require_role("producer")), s: Session = Depends(get_db)) -> dict:
    key = _producer_key(user)
    assets = [a for a in platform().assets.values()
              if next(x for x in chain().deployment["assets"] if x["id"] == a.id)["producer"] == key]
    ops = [_asset_ops(s, a) for a in assets]
    received = s.scalar(select(func.sum(Activity.amount_usdc)).where(
        Activity.user_id == user.id, Activity.kind == "payout")) or 0.0
    plan = PRODUCER_PLANS[key]
    return {
        "producer": {"name": user.name, "wallet": user.wallet_address},
        "usdc_balance": from_usdc(chain().c["usdc"].functions.balanceOf(user.wallet_address).call()),
        "revenue_received_usdc": round(received, 2),
        "raised_total_usdc": round(sum(o["raised_usdc"] for o in ops), 2),
        "investors_total": sum(o["investors"] for o in ops),
        "assets": ops,
        "subscription": {"plan": plan, **PLANS[plan], "plans": PLANS},
    }


@router.get("/producer/report/{asset_id}")
def report(asset_id: str, user: User = Depends(current_user), s: Session = Depends(get_db)) -> dict:
    """Everything the printable ESG & risk report needs, in one call."""
    if user.role not in ("producer", "signer") and not is_institutional(user):
        raise HTTPException(403, "Reports are available to producers, institutional investors and governance")
    p = platform()
    asset = p.assets.get(asset_id)
    if asset is None:
        raise HTTPException(404, "Unknown asset")
    esg = score_asset(s, asset, p.social[asset_id])
    batches = s.scalars(select(Batch).where(Batch.asset_id == asset_id).order_by(desc(Batch.id)).limit(48)).all()
    alerts = s.scalars(select(Alert).where(Alert.asset_id == asset_id).order_by(desc(Alert.id)).limit(20)).all()
    rejected = s.scalar(select(func.count()).select_from(Rejection).where(Rejection.asset_id == asset_id)) or 0
    anchored = [b for b in batches if b.chain_batch_id is not None]
    return {
        "asset": _asset_ops(s, asset), "esg": esg, "risk": score_risk(s, asset),
        "batches": [{"id": b.id, "period_start": b.period_start, "energy_kwh": b.energy_wh / 1000,
                     "verdict": b.verdict, "status": b.status, "revenue_usdc": b.revenue_usdc,
                     "data_hash": "0x" + b.data_hash, "tx_record": b.tx_record} for b in batches[:12]],
        "alerts": [{"kind": a.kind, "severity": a.severity, "title": a.title, "detail": a.detail,
                    "title_tr": a.title_tr, "detail_tr": a.detail_tr, "active": a.active,
                    "created_at": a.created_at} for a in alerts],
        "integrity": {"anchored_batches": len(anchored), "flagged_batches": sum(b.flagged for b in batches),
                      "rejected_messages": rejected},
        "contracts": {k: v["address"] for k, v in chain().deployment["contracts"].items()},
        "generated_for": user.name,
    }


@router.get("/platform/economics")
def economics(s: Session = Depends(get_db)) -> dict:
    """How Eco-Fraction earns money (business model 4.3), live where possible."""
    c = chain()
    treasury = from_usdc(c.c["usdc"].functions.balanceOf(c.deployment["accounts"]["treasury"]["address"]).call())
    fee_rate = c.deployment["params"]["feeBps"] / 10_000
    primary_volume = s.scalar(select(func.sum(Activity.amount_usdc)).where(Activity.kind == "buy")) or 0.0
    secondary_volume = s.scalar(select(func.sum(Trade.cost_usdc))) or 0.0
    secondary_fees = s.scalar(select(func.sum(Trade.fee_usdc))) or 0.0
    trades = s.scalar(select(func.count()).select_from(Trade)) or 0
    subscribers = {**PRODUCER_PLANS, "fund": INSTITUTIONAL_PLAN}
    mrr = sum(PLANS[p]["price_month"] for p in subscribers.values())
    verified_mwh = (s.scalar(select(func.sum(Batch.energy_wh)).where(
        Batch.status.in_(("distributed", "released")))) or 0) / 1e6
    co2_t = verified_mwh * 1000 * GRID_CO2_KG_PER_KWH / 1000
    annual_co2_t = sum(BENCHMARK_CF[a.kind] * a.capacity_kw * 8760 * GRID_CO2_KG_PER_KWH / 1000
                       for a in platform().assets.values())
    return {
        "live": {
            "treasury_usdc": round(treasury, 2), "fee_rate": fee_rate,
            "primary_volume_usdc": round(primary_volume, 2), "primary_fees_usdc": round(primary_volume * fee_rate, 2),
            "secondary_volume_usdc": round(secondary_volume, 2), "secondary_fees_usdc": round(secondary_fees, 2),
            "trades": trades,
        },
        "saas": {"mrr_usd": mrr, "arr_usd": mrr * 12,
                 "subscribers": [{"producer": k, "plan": v, "price_month": PLANS[v]["price_month"]}
                                 for k, v in subscribers.items()],
                 "plans": PLANS},
        "licensing": {"pipeline": LICENSING_PIPELINE, "pipeline_annual_usd": sum(x["annual_usd"] for x in LICENSING_PIPELINE)},
        "carbon": {"verified_co2_t": round(co2_t, 1), "annual_co2_t_portfolio": round(annual_co2_t),
                   "price_usd_t": CARBON_PRICE_USD_T, "platform_share": CARBON_PLATFORM_SHARE,
                   "potential_annual_platform_usd": round(annual_co2_t * CARBON_PRICE_USD_T * CARBON_PLATFORM_SHARE)},
    }
