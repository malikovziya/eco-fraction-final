"""Public read APIs: assets, live data, forecasts, ESG, batches, AI model cards, chain explorer."""

import json
import time
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..chain import chain, from_usdc
from ..db import Activity, Alert, Batch, HourlyEnergy, Reading, Rejection, User
from ..esg import BENCHMARK_CF, score_asset
from ..risk import score_risk
from ..services.ingest import batch_hash
from ..services.simctl import simctl
from ..state import platform
from .deps import get_db

router = APIRouter(prefix="/api")

_offering_cache: dict = {"at": 0.0, "data": {}}


def offerings() -> dict[int, int]:
    """Shares still for sale per token id (cached briefly: several dashboards poll this)."""
    if time.time() - _offering_cache["at"] > 2:
        primary = chain().c["primary"]
        _offering_cache["data"] = {t: primary.functions.offeredRemaining(t).call() for t in platform().by_token}
        _offering_cache["at"] = time.time()
    return _offering_cache["data"]


def asset_summary(s: Session, asset_id: str, with_esg: bool = True) -> dict:
    p = platform()
    asset = p.assets[asset_id]
    info = next(a for a in chain().deployment["assets"] if a["id"] == asset_id)
    remaining = offerings()[asset.token_id]
    tariff = chain().deployment["params"]["tariffPerKWhUsdc"]
    annual_revenue = BENCHMARK_CF[asset.kind] * asset.capacity_kw * 8760 * tariff
    investors = s.scalar(select(func.count(func.distinct(Activity.user_id)))
                         .where(Activity.kind == "buy", Activity.asset_id == asset_id)) or 0
    alerts = s.scalars(select(Alert.kind).where(Alert.asset_id == asset_id, Alert.active)).all()
    out = {
        "id": asset.id, "tokenId": asset.token_id, "name": asset.name, "kind": asset.kind,
        "region": asset.region, "lat": asset.lat, "lon": asset.lon, "capacity_kw": asset.capacity_kw,
        "turbines": asset.turbines, "social": p.social[asset.id],
        "valueUsd": info["valueUsd"], "totalShares": info["totalShares"], "offeredShares": info["offeredShares"],
        "remainingShares": remaining, "soldShares": info["offeredShares"] - remaining,
        "pricePerShare": chain().deployment["params"]["sharePriceUsdc"],
        "expectedYield": round(annual_revenue / info["valueUsd"], 4),
        "annualRevenueUsd": round(annual_revenue),
        "investors": investors, "live": p.latest.get(asset.id), "activeAlerts": sorted(set(alerts)),
    }
    if with_esg:
        out["esg"] = cached_esg(s, asset_id)
    return out


_esg_cache: dict[str, tuple[float, dict]] = {}


def cached_esg(s: Session, asset_id: str) -> dict:
    """ESG headline per asset, recomputed at most every 5 s (it scans the readings table)."""
    hit = _esg_cache.get(asset_id)
    if hit and time.time() - hit[0] < 5:
        return hit[1]
    p = platform()
    esg = score_asset(s, p.assets[asset_id], p.social[asset_id])
    value = {"score": esg["score"], "rating": esg["rating"]}
    _esg_cache[asset_id] = (time.time(), value)
    return value


@router.get("/health")
def health() -> dict:
    import socket

    def up(port: int) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            return False

    try:
        block = chain().w3.eth.block_number
    except Exception:
        block = None
    return {"api": True, "mqtt": up(1883), "kafka": up(19092), "chain": block is not None, "chainBlock": block,
            "stats": platform().stats, "sim": platform().sim_status}


@router.get("/assets")
def list_assets(s: Session = Depends(get_db)) -> list[dict]:
    return [asset_summary(s, aid) for aid in platform().assets]


@router.get("/assets/{asset_id}")
def get_asset(asset_id: str, s: Session = Depends(get_db)) -> dict:
    if asset_id not in platform().assets:
        raise HTTPException(404, "Unknown asset")
    return asset_summary(s, asset_id)


@router.get("/assets/{asset_id}/readings")
def readings(asset_id: str, limit: int = 144, s: Session = Depends(get_db)) -> list[dict]:
    rows = s.scalars(select(Reading).where(Reading.asset_id == asset_id).order_by(desc(Reading.id)).limit(limit)).all()
    out = []
    for r in reversed(rows):
        raw = json.loads(r.raw)
        out.append({"ts": r.ts, "power_kw": r.power_kw, "energy_kwh": r.energy_kwh,
                    "fraud_prob": round(r.fraud_prob, 4), "degrade_prob": round(r.degrade_prob, 4),
                    "predicted": r.predicted_class, "irradiance_wm2": raw.get("irradiance_wm2"),
                    "wind_speed_ms": raw.get("wind_speed_ms"), "batch_id": r.batch_id})
    return out


@router.get("/assets/{asset_id}/forecast")
def forecast(asset_id: str, s: Session = Depends(get_db)) -> dict:
    rows = s.scalars(select(HourlyEnergy).where(HourlyEnergy.asset_id == asset_id)
                     .order_by(desc(HourlyEnergy.hour)).limit(48)).all()
    return {
        "history": [{"hour": r.hour, "ratio": round(r.ratio, 4), "energy_kwh": r.energy_kwh,
                     "backfilled": r.backfilled} for r in reversed(rows)],
        "forecast": platform().forecasts.get(asset_id, []),
        "model": platform().forecaster.card["kinds"][platform().assets[asset_id].kind],
    }


@router.get("/assets/{asset_id}/esg")
def esg(asset_id: str, s: Session = Depends(get_db)) -> dict:
    p = platform()
    return score_asset(s, p.assets[asset_id], p.social[asset_id])


@router.get("/assets/{asset_id}/risk")
def risk(asset_id: str, s: Session = Depends(get_db)) -> dict:
    p = platform()
    if asset_id not in p.assets:
        raise HTTPException(404, "Unknown asset")
    return score_risk(s, p.assets[asset_id])


@router.get("/assets/{token_id}/metadata")
def token_metadata(token_id: str, s: Session = Depends(get_db)) -> dict:
    """ERC-1155 metadata (the token URI points here). Accepts decimal or 64-char hex ids."""
    tid = int(token_id, 16) if len(token_id) == 64 else int(token_id)
    asset = platform().by_token.get(tid)
    if asset is None:
        raise HTTPException(404, "Unknown token")
    return {
        "name": f"{asset.name} share",
        "description": f"One share of {asset.name} ({asset.capacity_kw / 1000:.0f} MW {asset.kind}, {asset.region}, "
                       f"Azerbaijan). Earns a pro-rata share of verified energy revenue.",
        "decimals": 0,
        "properties": {"asset_id": asset.id, "kind": asset.kind, "capacity_kw": asset.capacity_kw,
                       "lat": asset.lat, "lon": asset.lon},
    }


def batch_dict(b: Batch) -> dict:
    return {
        "id": b.id, "asset_id": b.asset_id, "period_start": b.period_start, "period_end": b.period_end,
        "readings": b.readings_count, "energy_kwh": b.energy_wh / 1000, "data_hash": "0x" + b.data_hash,
        "anomaly_score": b.anomaly_score / 10000, "suspicious_readings": b.suspicious_readings,
        "flagged": b.flagged, "verdict": b.verdict, "explanation": b.explanation, "status": b.status,
        "chain_batch_id": b.chain_batch_id, "revenue_usdc": b.revenue_usdc,
        "tx_record": b.tx_record, "tx_settle": b.tx_settle, "tx_payout": b.tx_payout,
    }


@router.get("/batches")
def batches(asset_id: str | None = None, flagged: bool | None = None, status: str | None = None, limit: int = 50,
            s: Session = Depends(get_db)) -> list[dict]:
    q = select(Batch).order_by(desc(Batch.id)).limit(limit)
    if asset_id:
        q = q.where(Batch.asset_id == asset_id)
    if flagged is not None:
        q = q.where(Batch.flagged == flagged)
    if status:
        q = q.where(Batch.status == status)
    return [batch_dict(b) for b in s.scalars(q)]


@router.get("/batches/{batch_id}/readings")
def batch_readings(batch_id: int, s: Session = Depends(get_db)) -> list[dict]:
    """The signed readings inside one batch, with the AI score of each (evidence for reviewers)."""
    out = []
    for r in s.scalars(select(Reading).where(Reading.batch_id == batch_id).order_by(Reading.id)):
        raw = json.loads(r.raw)
        out.append({"ts": r.ts, "power_kw": r.power_kw, "fraud_prob": round(r.fraud_prob, 4),
                    "degrade_prob": round(r.degrade_prob, 4), "predicted": r.predicted_class,
                    "irradiance_wm2": raw.get("irradiance_wm2"), "wind_speed_ms": raw.get("wind_speed_ms"),
                    "capacity_kw": raw.get("capacity_kw")})
    return out


@router.get("/batches/{batch_id}")
def batch(batch_id: int, s: Session = Depends(get_db)) -> dict:
    b = s.get(Batch, batch_id)
    if b is None:
        raise HTTPException(404, "Unknown batch")
    return batch_dict(b)


@router.get("/batches/{batch_id}/verify")
def verify_batch(batch_id: int, s: Session = Depends(get_db)) -> dict:
    """Recompute the hash of the stored signed readings and compare it with the on-chain record."""
    b = s.get(Batch, batch_id)
    if b is None or b.chain_batch_id is None:
        raise HTTPException(404, "Batch not anchored yet")
    raws = s.scalars(select(Reading.raw).where(Reading.batch_id == batch_id).order_by(Reading.id)).all()
    recomputed = batch_hash(list(raws))
    onchain = chain().c["oracle"].functions.getBatch(b.chain_batch_id).call()
    onchain_hash = onchain[4].hex()
    return {
        "batch_id": batch_id, "chain_batch_id": b.chain_batch_id, "readings": len(raws),
        "recomputed_hash": "0x" + recomputed, "onchain_hash": "0x" + onchain_hash.removeprefix("0x"),
        "match": recomputed == onchain_hash.removeprefix("0x"),
        "onchain": {"asset": onchain[0], "energy_wh": onchain[3], "anomaly_score": onchain[5] / 10000,
                    "flagged": onchain[6], "recorded_at_block_time": onchain[7]},
        "sample_reading": json.loads(raws[0]) if raws else None,
    }


@router.get("/batches/{batch_id}/raw")
def batch_raw(batch_id: int, s: Session = Depends(get_db)) -> dict:
    """The exact signed device messages of a batch, so a browser can recompute the hash itself."""
    b = s.get(Batch, batch_id)
    if b is None or b.chain_batch_id is None:
        raise HTTPException(404, "Batch not anchored yet")
    raws = s.scalars(select(Reading.raw).where(Reading.batch_id == batch_id).order_by(Reading.id)).all()
    return {"batch_id": batch_id, "chain_batch_id": b.chain_batch_id, "readings": list(raws)}


@router.get("/alerts")
def alerts(active: bool | None = None, limit: int = 30, s: Session = Depends(get_db)) -> list[dict]:
    q = select(Alert).order_by(desc(Alert.id)).limit(limit)
    if active is not None:
        q = q.where(Alert.active == active)
    return [{"id": a.id, "asset_id": a.asset_id, "kind": a.kind, "severity": a.severity, "title": a.title,
             "detail": a.detail, "title_tr": a.title_tr, "detail_tr": a.detail_tr, "batch_id": a.batch_id,
             "active": a.active, "created_at": a.created_at}
            for a in s.scalars(q)]


@router.get("/rejections")
def rejections(limit: int = 30, s: Session = Depends(get_db)) -> list[dict]:
    return [{"asset_id": r.asset_id, "reason": r.reason, "ts": r.ts, "claimed_power_kw": r.claimed_power_kw,
             "created_at": r.created_at}
            for r in s.scalars(select(Rejection).order_by(desc(Rejection.id)).limit(limit))]


@router.get("/ai/models")
def model_cards() -> dict:
    p = platform()
    return {"anomaly": p.detector.card, "forecast": p.forecaster.card}


@router.get("/platform/stats")
def platform_stats(s: Session = Depends(get_db)) -> dict:
    c = chain()
    distributed = sum(from_usdc(c.c["distributor"].functions.totalDistributed(t).call()) for t in platform().by_token)
    investors = s.scalar(select(func.count()).select_from(User).where(User.role == "investor")) or 0
    return {
        "revenue_distributed_usdc": round(distributed, 2),
        "revenue_escrowed_usdc": from_usdc(c.c["distributor"].functions.totalEscrowed().call()),
        "treasury_fees_usdc": from_usdc(c.c["usdc"].functions.balanceOf(c.deployment["accounts"]["treasury"]["address"]).call()),
        "investors": investors,
        "energy_mwh": round((s.scalar(select(func.sum(Batch.energy_wh))) or 0) / 1e6, 2),
        **platform().stats,
    }


# ── Simulator control (demo panel) ──────────────────────────────────────────

class FaultIn(BaseModel):
    asset_id: str
    fault: str  # inflate | flatline | degrade | forge
    on: bool = True


@router.post("/sim/fault")
def sim_fault(body: FaultIn) -> dict:
    if body.fault not in ("inflate", "flatline", "degrade", "forge"):
        raise HTTPException(400, "Unknown fault")
    simctl.send({"cmd": "fault", "asset": body.asset_id, "fault": body.fault, "on": body.on})
    return {"ok": True}


@router.post("/sim/clear")
def sim_clear() -> dict:
    simctl.send({"cmd": "clear"})
    return {"ok": True}


class SpeedIn(BaseModel):
    value: int


@router.post("/sim/speed")
def sim_speed(body: SpeedIn) -> dict:
    simctl.send({"cmd": "speed", "value": body.value})
    return {"ok": True}


# ── Transaction explorer ────────────────────────────────────────────────────

@router.get("/chain/tx/{tx_hash}")
def explore_tx(tx_hash: str) -> dict:
    c = chain()
    try:
        tx = c.w3.eth.get_transaction(tx_hash)
        receipt = c.w3.eth.get_transaction_receipt(tx_hash)
    except Exception:
        raise HTTPException(404, "Transaction not found")
    block = c.w3.eth.get_block(receipt.blockNumber)
    events = []
    for log in receipt.logs:
        name = c.names.get(log.address.lower())
        if name is None:
            continue
        contract = c.c[name]
        for ev_abi in (x for x in contract.abi if x["type"] == "event"):
            try:
                ev = getattr(contract.events, ev_abi["name"])().process_log(log)
            except Exception:
                continue
            events.append({"contract": name, "event": ev["event"],
                           "args": {k: (v.hex() if isinstance(v, bytes) else v) for k, v in ev["args"].items()}})
            break
    to_name = c.names.get((tx["to"] or "").lower())
    fn = None
    if to_name:
        try:
            func_obj, params = c.c[to_name].decode_function_input(tx["input"])
            fn = {"name": func_obj.fn_name,
                  "params": {k: (v.hex() if isinstance(v, bytes) else v) for k, v in params.items()}}
        except Exception:
            pass
    return {
        "hash": tx_hash, "status": "success" if receipt.status == 1 else "reverted",
        "block": receipt.blockNumber, "timestamp": datetime.fromtimestamp(block.timestamp).isoformat(),
        "from": tx["from"], "to": tx["to"], "to_contract": to_name, "function": fn,
        "gas_used": receipt.gasUsed, "events": events,
    }


@router.get("/chain/contracts")
def contracts() -> dict:
    c = chain()
    return {"chainId": c.deployment["chainId"], "network": "Local EVM (Polygon-compatible)",
            "contracts": {k: v["address"] for k, v in c.deployment["contracts"].items()},
            "accounts": c.deployment["accounts"], "params": c.deployment["params"]}


@router.get("/chain/recent")
def recent_transactions(limit: int = 25) -> list[dict]:
    """Latest platform transactions, newest first, with the contract function each one called."""
    c = chain()
    out, number = [], c.w3.eth.block_number
    while number >= 0 and len(out) < limit:
        block = c.w3.eth.get_block(number, full_transactions=True)
        for tx in reversed(block.transactions):
            to_name = c.names.get((tx["to"] or "").lower())
            fn = None
            if to_name:
                try:
                    fn = c.c[to_name].decode_function_input(tx["input"])[0].fn_name
                except Exception:
                    pass
            out.append({"hash": "0x" + tx["hash"].hex().removeprefix("0x"), "block": number,
                        "timestamp": block.timestamp, "from": tx["from"], "to_contract": to_name, "function": fn})
        number -= 1
    return out[:limit]


@router.get("/config")
def app_config() -> dict:
    from ..config import FX_RATES

    c = chain()
    return {"fx": FX_RATES, "params": c.deployment["params"], "chainId": c.deployment["chainId"]}


@router.get("/chain/public")
def public_deployment() -> dict | None:
    """The optional public-testnet deployment (contracts/deployments/amoy.json), if one exists."""
    from ..config import ROOT_DIR

    path = ROOT_DIR / "contracts" / "deployments" / "amoy.json"
    return json.loads(path.read_text()) if path.exists() else None
