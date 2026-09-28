"""Accounts, KYC, wallet, investing and portfolio."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..chain import TxFailed, chain, from_usdc, tx_hex
from ..db import Activity, SessionToken, User, utcnow
from ..esg import BENCHMARK_CF, score_asset
from ..hub import hub
from ..security import check_password, hash_password, new_session_token
from ..state import platform
from ..wallets import approve_platform_contracts, deposit, new_wallet, signer_for, verify_kyc
from .deps import current_user, get_db, require_role
from .producer import INSTITUTIONAL_PLAN, PLANS, is_institutional

router = APIRouter(prefix="/api")


def user_dict(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "persona": u.persona, "title": u.title,
            "wallet": u.wallet_address, "kyc": u.kyc_status}


def _session(s: Session, user: User) -> dict:
    token = new_session_token()
    s.add(SessionToken(token=token, user_id=user.id))
    s.commit()
    return {"token": token, "user": user_dict(user)}


# ── Auth ────────────────────────────────────────────────────────────────────

@router.get("/auth/personas")
def personas(s: Session = Depends(get_db)) -> list[dict]:
    return [user_dict(u) for u in s.scalars(select(User).where(User.persona.is_not(None)).order_by(User.id))]


class PersonaIn(BaseModel):
    persona: str


@router.post("/auth/persona")
def login_persona(body: PersonaIn, s: Session = Depends(get_db)) -> dict:
    user = s.scalar(select(User).where(User.persona == body.persona))
    if user is None:
        raise HTTPException(404, "Unknown persona")
    return _session(s, user)


class SignupIn(BaseModel):
    name: str = Field(min_length=2)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=6)


@router.post("/auth/signup")
def signup(body: SignupIn, s: Session = Depends(get_db)) -> dict:
    if s.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(409, "Email already registered")
    address, key_enc = new_wallet()
    user = User(name=body.name, email=body.email, password_hash=hash_password(body.password), role="investor",
                title="Individual investor", wallet_address=address, wallet_key_enc=key_enc)
    s.add(user)
    s.commit()
    return _session(s, user)


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
def login(body: LoginIn, s: Session = Depends(get_db)) -> dict:
    user = s.scalar(select(User).where(User.email == body.email))
    if user is None or not user.password_hash or not check_password(body.password, user.password_hash):
        raise HTTPException(401, "Wrong email or password")
    return _session(s, user)


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict:
    return user_dict(user)


# ── KYC + wallet ────────────────────────────────────────────────────────────

class KycIn(BaseModel):
    full_name: str = Field(min_length=3)
    national_id: str = Field(min_length=5)
    country: str
    birth_date: str


@router.post("/kyc")
def submit_kyc(body: KycIn, user: User = Depends(current_user), s: Session = Depends(get_db)) -> dict:
    """Sandbox KYC: document checks pass instantly, then the wallet is whitelisted on-chain."""
    user = s.merge(user)
    if user.kyc_status == "verified":
        return {"status": "verified"}
    tx = verify_kyc(s, user)
    approve_platform_contracts(user)
    s.commit()
    return {"status": "verified", "tx_hash": tx,
            "checks": ["Identity document", "Sanctions & PEP screening", "Liveness check", "Wallet whitelisted"]}


class DepositIn(BaseModel):
    amount: float = Field(gt=0, le=1_000_000)
    method: str = "bank_transfer"
    bank: str | None = None


@router.post("/wallet/deposit")
def wallet_deposit(body: DepositIn, user: User = Depends(current_user), s: Session = Depends(get_db)) -> dict:
    user = s.merge(user)
    tx = deposit(s, user, body.amount, body.method, {"bank": body.bank} if body.bank else None)
    s.commit()
    return {"tx_hash": tx, "amount": body.amount}


# ── Investing ───────────────────────────────────────────────────────────────

class InvestIn(BaseModel):
    asset_id: str
    shares: int = Field(gt=0)


@router.post("/invest")
def invest(body: InvestIn, user: User = Depends(require_role("investor")), s: Session = Depends(get_db)) -> dict:
    user = s.merge(user)
    asset = platform().assets.get(body.asset_id)
    if asset is None:
        raise HTTPException(404, "Unknown asset")
    if user.kyc_status != "verified":
        raise HTTPException(403, "Complete KYC before investing")
    c = chain()
    cost, fee = c.c["primary"].functions.quote(asset.token_id, body.shares).call()
    if from_usdc(cost) < c.deployment["params"]["minInvestmentUsdc"]:
        raise HTTPException(400, f"Minimum investment is ${c.deployment['params']['minInvestmentUsdc']}")
    if c.c["usdc"].functions.balanceOf(user.wallet_address).call() < cost:
        raise HTTPException(400, "Insufficient USDC balance")
    try:
        receipt = c.send(signer_for(user), c.c["primary"].functions.buy(asset.token_id, body.shares))
    except TxFailed:
        raise HTTPException(400, "Purchase reverted on-chain")
    s.add(Activity(user_id=user.id, kind="buy", asset_id=asset.id, shares=body.shares,
                   amount_usdc=from_usdc(cost), tx_hash=tx_hex(receipt), detail={"fee_usdc": from_usdc(fee)}))
    s.commit()
    hub.publish("investment", {"name": user.name, "asset_id": asset.id, "asset_name": asset.name,
                               "shares": body.shares, "amount_usdc": from_usdc(cost), "tx_hash": tx_hex(receipt)})
    return {"tx_hash": tx_hex(receipt), "shares": body.shares, "cost_usdc": from_usdc(cost), "fee_usdc": from_usdc(fee)}


@router.get("/portfolio")
def portfolio(user: User = Depends(current_user), s: Session = Depends(get_db)) -> dict:
    c = chain()
    p = platform()
    tariff = c.deployment["params"]["tariffPerKWhUsdc"]
    info = {a["id"]: a for a in c.deployment["assets"]}
    assets = list(p.assets.values())
    balances = c.c["token"].functions.balanceOfBatch([user.wallet_address] * len(assets),
                                                     [a.token_id for a in assets]).call()
    holdings, invested_value, annual_income, esg_weighted = [], 0.0, 0.0, 0.0
    for a, shares in zip(assets, balances):
        if shares == 0:
            continue
        total = info[a.id]["totalShares"]
        annual_asset_revenue = BENCHMARK_CF[a.kind] * a.capacity_kw * 8760 * tariff
        earned = s.scalar(select(func.sum(Activity.amount_usdc)).where(
            Activity.user_id == user.id, Activity.kind == "payout", Activity.asset_id == a.id)) or 0.0
        esg = score_asset(s, a, p.social[a.id])
        value = shares * c.deployment["params"]["sharePriceUsdc"]
        holdings.append({
            "asset_id": a.id, "name": a.name, "kind": a.kind, "shares": shares, "ownership": shares / total,
            "value_usdc": value, "earned_usdc": round(earned, 6),
            "claimable_usdc": from_usdc(c.c["distributor"].functions.claimable(a.token_id, user.wallet_address).call()),
            "projected_annual_income_usdc": round(annual_asset_revenue * shares / total, 2),
            "co2_avoided_annual_kg": round(BENCHMARK_CF[a.kind] * a.capacity_kw * 8760 * shares / total * 0.44, 1),
            "esg": {"score": esg["score"], "rating": esg["rating"]},
        })
        invested_value += value
        annual_income += annual_asset_revenue * shares / total
        esg_weighted += esg["score"] * value
    total_earned = s.scalar(select(func.sum(Activity.amount_usdc)).where(
        Activity.user_id == user.id, Activity.kind == "payout")) or 0.0
    # Actual earning pace: payouts in the last real minute, per simulated hour
    window_s = 60
    recent = s.scalar(select(func.sum(Activity.amount_usdc)).where(
        Activity.user_id == user.id, Activity.kind == "payout",
        Activity.created_at >= utcnow() - timedelta(seconds=window_s))) or 0.0
    speed = p.sim_status.get("speed", 300)
    sim_hours = max(1 / 12, window_s * speed / 3600)
    return {
        "user": user_dict(user),
        "usdc_balance": from_usdc(c.c["usdc"].functions.balanceOf(user.wallet_address).call()),
        "holdings": holdings,
        "invested_value_usdc": invested_value,
        "total_earned_usdc": round(total_earned, 6),
        "projected_annual_income_usdc": round(annual_income, 2),
        "portfolio_esg": round(esg_weighted / invested_value, 1) if invested_value else None,
        "earning_rate_per_sim_hour": round(recent / sim_hours, 6),
        "subscription": {"plan": INSTITUTIONAL_PLAN, **PLANS[INSTITUTIONAL_PLAN]} if is_institutional(user) else None,
    }


@router.get("/activity")
def activity(limit: int = 50, user: User = Depends(current_user), s: Session = Depends(get_db)) -> list[dict]:
    rows = s.scalars(select(Activity).where(Activity.user_id == user.id).order_by(desc(Activity.id)).limit(limit))
    return [{"id": a.id, "kind": a.kind, "asset_id": a.asset_id, "shares": a.shares, "amount_usdc": a.amount_usdc,
             "tx_hash": a.tx_hash, "detail": a.detail, "created_at": a.created_at} for a in rows]
