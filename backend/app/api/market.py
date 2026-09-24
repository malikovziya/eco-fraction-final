"""Secondary marketplace: list shares, buy listings, trade history."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from ..chain import TxFailed, chain, tx_hex
from ..db import Trade, User
from ..state import platform
from ..trading import create_listing, fill_listing, listings
from ..wallets import signer_for
from .deps import get_db, require_role

router = APIRouter(prefix="/api/market")


@router.get("/listings")
def get_listings(asset_id: str | None = None, s: Session = Depends(get_db)) -> list[dict]:
    rows = [l for l in listings(s) if l["available"] > 0]
    if asset_id:
        rows = [l for l in rows if l["asset_id"] == asset_id]
    return sorted(rows, key=lambda l: (l["asset_id"], l["price_usdc"]))


@router.get("/trades")
def trades(limit: int = 30, s: Session = Depends(get_db)) -> list[dict]:
    names = {u.id: u.name for u in s.scalars(select(User))}
    return [{"id": t.id, "listing_id": t.listing_id, "asset_id": t.asset_id, "shares": t.shares,
             "price_usdc": t.price_usdc, "cost_usdc": t.cost_usdc, "fee_usdc": t.fee_usdc, "tx_hash": t.tx_hash,
             "buyer": names.get(t.buyer_id, "–"), "created_at": t.created_at}
            for t in s.scalars(select(Trade).order_by(desc(Trade.id)).limit(limit))]


@router.get("/summary")
def summary(s: Session = Depends(get_db)) -> list[dict]:
    """Per asset: last trade price, 24h-equivalent volume and best ask."""
    active = listings(s)
    out = []
    for asset in platform().assets.values():
        last = s.scalar(select(Trade).where(Trade.asset_id == asset.id).order_by(desc(Trade.id)).limit(1))
        volume = s.scalar(select(func.sum(Trade.cost_usdc)).where(Trade.asset_id == asset.id)) or 0.0
        count = s.scalar(select(func.count()).select_from(Trade).where(Trade.asset_id == asset.id)) or 0
        asks = [l["price_usdc"] for l in active if l["asset_id"] == asset.id and l["available"] > 0]
        out.append({"asset_id": asset.id, "name": asset.name, "kind": asset.kind,
                    "last_price": last.price_usdc if last else None, "volume_usdc": round(volume, 2), "trades": count,
                    "best_ask": min(asks) if asks else None, "listings": len(asks)})
    return out


class ListIn(BaseModel):
    asset_id: str
    shares: int = Field(gt=0)
    price_usdc: float = Field(gt=0, le=1000)


@router.post("/list")
def list_shares(body: ListIn, user: User = Depends(require_role("investor")), s: Session = Depends(get_db)) -> dict:
    user = s.merge(user)
    asset = platform().assets.get(body.asset_id)
    if asset is None:
        raise HTTPException(404, "Unknown asset")
    held = chain().c["token"].functions.balanceOf(user.wallet_address, asset.token_id).call()
    if body.shares > held:
        raise HTTPException(400, f"You hold only {held} shares")
    try:
        return create_listing(s, user, asset.token_id, body.shares, round(body.price_usdc, 2))
    except TxFailed:
        raise HTTPException(400, "Listing reverted on-chain")


class BuyIn(BaseModel):
    listing_id: int
    shares: int = Field(gt=0)


@router.post("/buy")
def buy_listing(body: BuyIn, user: User = Depends(require_role("investor")), s: Session = Depends(get_db)) -> dict:
    user = s.merge(user)
    if user.kyc_status != "verified":
        raise HTTPException(403, "Complete KYC before trading")
    listing = next((l for l in listings(s) if l["id"] == body.listing_id), None)
    if listing is None or listing["available"] < body.shares:
        raise HTTPException(400, "Listing no longer available")
    if listing["seller"].lower() == user.wallet_address.lower():
        raise HTTPException(400, "You cannot buy your own listing")
    try:
        return fill_listing(s, user, body.listing_id, body.shares)
    except ValueError as e:
        raise HTTPException(400, str(e))


class CancelIn(BaseModel):
    listing_id: int


@router.post("/cancel")
def cancel(body: CancelIn, user: User = Depends(require_role("investor")), s: Session = Depends(get_db)) -> dict:
    c = chain()
    try:
        receipt = c.send(signer_for(s.merge(user)), c.c["market"].functions.cancel(body.listing_id))
    except TxFailed:
        raise HTTPException(400, "Only the seller can cancel an active listing")
    return {"tx_hash": tx_hex(receipt)}
