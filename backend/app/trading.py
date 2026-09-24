"""Secondary-market operations shared by the API and the background market makers."""

import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from .chain import TxFailed, chain, from_usdc, to_usdc, tx_hex
from .db import Activity, Trade, User
from .hub import hub
from .state import platform
from .wallets import signer_for


_closed: set[int] = set()  # listings that can never reopen (filled or cancelled)
_cache: dict = {"at": 0.0, "rows": None}


def invalidate_listings() -> None:
    _cache["rows"] = None


def listings(s: Session) -> list[dict]:
    """Active listings, cached for 2 s and invalidated on every list/buy made through the platform."""
    if _cache["rows"] is not None and time.time() - _cache["at"] < 2:
        return _cache["rows"]
    _cache["rows"], _cache["at"] = _read_listings(s), time.time()
    return _cache["rows"]


def _read_listings(s: Session) -> list[dict]:
    """Active listings with live availability (sellers keep shares until a buyer fills)."""
    c = chain()
    market, token = c.c["market"], c.c["token"]
    users = {u.wallet_address.lower(): u for u in s.scalars(select(User))}
    out = []
    for i in range(market.functions.listingCount().call()):
        if i in _closed:
            continue
        seller, token_id, shares, price, active = market.functions.listings(i).call()
        if not active or shares == 0:
            _closed.add(i)
            continue
        balance = token.functions.balanceOf(seller, token_id).call()
        asset = platform().by_token[token_id]
        user = users.get(seller.lower())
        out.append({
            "id": i, "asset_id": asset.id, "asset_name": asset.name, "kind": asset.kind, "token_id": token_id,
            "seller": seller, "seller_name": _mask(user.name) if user else "–", "seller_id": user.id if user else None,
            "shares": shares, "available": min(shares, balance), "price_usdc": from_usdc(price),
            "premium": from_usdc(price) / 10 - 1,
        })
    return out


def _mask(name: str) -> str:
    parts = name.split()
    return name if len(parts) < 2 or parts[-1].endswith(".") else f"{parts[0]} {parts[-1][0]}."


def ensure_trading_approvals(user: User) -> None:
    """Marketplace needs the seller's share approval and the buyer's USDC allowance, once."""
    c = chain()
    acct = signer_for(user)
    if not c.c["token"].functions.isApprovedForAll(user.wallet_address, c.c["market"].address).call():
        c.send(acct, c.c["token"].functions.setApprovalForAll(c.c["market"].address, True))
    if c.c["usdc"].functions.allowance(user.wallet_address, c.c["market"].address).call() < 2**128:
        c.send(acct, c.c["usdc"].functions.approve(c.c["market"].address, 2**256 - 1))


def create_listing(s: Session, user: User, token_id: int, shares: int, price: float) -> dict:
    c = chain()
    ensure_trading_approvals(user)
    receipt = c.send(signer_for(user), c.c["market"].functions.list(token_id, shares, to_usdc(price)))
    listing_id = c.events("market", "Listed", receipt)[0]["args"]["listingId"]
    invalidate_listings()
    asset = platform().by_token[token_id]
    hub.publish("listing", {"listing_id": listing_id, "asset_id": asset.id, "shares": shares, "price_usdc": price,
                            "seller": _mask(user.name)})
    return {"listing_id": listing_id, "tx_hash": tx_hex(receipt)}


def fill_listing(s: Session, buyer: User, listing_id: int, shares: int) -> dict:
    c = chain()
    ensure_trading_approvals(buyer)
    try:
        receipt = c.send(signer_for(buyer), c.c["market"].functions.buy(listing_id, shares))
    except TxFailed as e:
        raise ValueError("Trade reverted on-chain") from e
    ev = c.events("market", "Traded", receipt)[0]["args"]
    invalidate_listings()
    seller_addr, token_id, _, price, _ = c.c["market"].functions.listings(listing_id).call()
    seller = s.scalar(select(User).where(User.wallet_address == seller_addr))
    asset = platform().by_token[token_id]
    cost, fee = from_usdc(ev["cost"]), from_usdc(ev["fee"])
    tx = tx_hex(receipt)
    s.add(Trade(listing_id=listing_id, asset_id=asset.id, shares=shares, price_usdc=from_usdc(price), cost_usdc=cost,
                fee_usdc=fee, buyer_id=buyer.id, seller_id=seller.id if seller else None, tx_hash=tx))
    s.add(Activity(user_id=buyer.id, kind="trade_buy", asset_id=asset.id, shares=shares, amount_usdc=cost, tx_hash=tx,
                   detail={"listing_id": listing_id, "price_usdc": from_usdc(price)}))
    if seller:
        s.add(Activity(user_id=seller.id, kind="sell", asset_id=asset.id, shares=shares, amount_usdc=cost - fee,
                       tx_hash=tx, detail={"listing_id": listing_id, "fee_usdc": fee}))
    s.commit()
    hub.publish("trade", {"listing_id": listing_id, "asset_id": asset.id, "asset_name": asset.name, "shares": shares,
                          "price_usdc": from_usdc(price), "cost_usdc": cost, "fee_usdc": fee, "tx_hash": tx,
                          "buyer": _mask(buyer.name), "buyer_id": buyer.id,
                          "seller_id": seller.id if seller else None})
    return {"tx_hash": tx, "cost_usdc": cost, "fee_usdc": fee}
