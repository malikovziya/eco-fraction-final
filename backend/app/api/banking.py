"""Open Banking (PSD2-style) sandbox: consent -> bank authorization -> on-chain settlement.

Deposits mint test USDC 1:1 (fiat on-ramp); withdrawals move USDC from the investor's wallet
to the platform's off-ramp account (fiat payout). Banks are fictional sandbox institutions.
"""

import secrets
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..chain import chain, from_usdc, to_usdc, tx_hex
from ..db import Activity, User
from ..hub import hub
from ..wallets import deposit, signer_for
from .deps import current_user, get_db

router = APIRouter(prefix="/api/banking")

BANKS = [
    {"id": "caspian", "name": "Caspian Demo Bank", "country": "AZ", "bic": "CDBAAZ22", "color": "#0ea5e9"},
    {"id": "absheron", "name": "Absheron Sandbox Bank", "country": "AZ", "bic": "ASBKAZ22", "color": "#10b981"},
    {"id": "anadolu", "name": "Anadolu Test Bankası", "country": "TR", "bic": "ATBKTRIS", "color": "#f59e0b"},
    {"id": "bosphorus", "name": "Bosphorus Demo Bank", "country": "TR", "bic": "BDBKTRIS", "color": "#a78bfa"},
]
SANDBOX_OTP = "123456"
CONSENT_TTL_S = 300
_consents: dict[str, dict] = {}


def _iban(bank: dict, user_id: int) -> str:
    bank_code = sum(ord(ch) * (i + 1) for i, ch in enumerate(bank["id"])) % 10**8
    digits = f"{user_id:010d}{bank_code:08d}"
    prefix = "AZ21" if bank["country"] == "AZ" else "TR33"
    body = f"{bank['bic'][:4]}{digits}"
    return f"{prefix} " + " ".join(body[i:i + 4] for i in range(0, len(body), 4))


@router.get("/banks")
def banks() -> list[dict]:
    return BANKS


class ConsentIn(BaseModel):
    bank_id: str
    type: str  # deposit | withdraw
    amount: float = Field(gt=0, le=100_000)


@router.post("/consents")
def create_consent(body: ConsentIn, user: User = Depends(current_user)) -> dict:
    bank = next((b for b in BANKS if b["id"] == body.bank_id), None)
    if bank is None or body.type not in ("deposit", "withdraw"):
        raise HTTPException(400, "Unknown bank or operation")
    if body.type == "withdraw":
        balance = from_usdc(chain().c["usdc"].functions.balanceOf(user.wallet_address).call())
        if body.amount > balance:
            raise HTTPException(400, "Insufficient USDC balance")
    consent_id = "cns_" + secrets.token_hex(8)
    consent = {
        "consent_id": consent_id, "user_id": user.id, "bank": bank, "type": body.type, "amount": body.amount,
        "account_iban": _iban(bank, user.id),
        "scopes": ["accounts:read", "payments:initiate"] if body.type == "deposit" else ["accounts:read", "payments:receive"],
        "status": "awaiting_authorization", "expires_at": time.time() + CONSENT_TTL_S,
        "sandbox_otp": SANDBOX_OTP,
    }
    _consents[consent_id] = consent
    return consent


class AuthorizeIn(BaseModel):
    otp: str


@router.post("/consents/{consent_id}/authorize")
def authorize(consent_id: str, body: AuthorizeIn, user: User = Depends(current_user),
              s: Session = Depends(get_db)) -> dict:
    consent = _consents.get(consent_id)
    if consent is None or consent["user_id"] != user.id:
        raise HTTPException(404, "Consent not found")
    if consent["status"] != "awaiting_authorization" or time.time() > consent["expires_at"]:
        raise HTTPException(400, "Consent expired or already used")
    if body.otp != SANDBOX_OTP:
        raise HTTPException(401, "Wrong one-time code")
    consent["status"] = "authorized"
    user = s.merge(user)
    reference = "EF" + secrets.token_hex(4).upper()
    detail = {"bank": consent["bank"]["name"], "iban": consent["account_iban"], "reference": reference,
              "rail": "PSD2 sandbox"}
    if consent["type"] == "deposit":
        tx = deposit(s, user, consent["amount"], method="open_banking", detail=detail)
    else:
        c = chain()
        receipt = c.send(signer_for(user), c.c["usdc"].functions.transfer(c.platform.address, to_usdc(consent["amount"])))
        tx = tx_hex(receipt)
        s.add(Activity(user_id=user.id, kind="withdraw", amount_usdc=consent["amount"], tx_hash=tx,
                       detail={"method": "open_banking", **detail}))
    s.commit()
    consent["status"] = "settled"
    hub.publish("banking", {"user_id": user.id, "type": consent["type"], "amount": consent["amount"], "tx_hash": tx})
    return {"status": "settled", "tx_hash": tx, "reference": reference, "amount": consent["amount"],
            "type": consent["type"]}
