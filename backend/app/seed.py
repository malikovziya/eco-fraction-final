"""Demo personas and pre-demo history, created once per fresh deployment."""

import random
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from iot.assets import Asset
from iot.physics import SolarModel, WindModel

from .chain import chain
from .db import HourlyEnergy, User
from .services.market import seed_portfolio
from .wallets import approve_platform_contracts, deposit, new_wallet, verify_kyc

PERSONAS = [
    # key, name, role, title, dev-mnemonic account role (None = new custodial wallet)
    ("aylin", "Aylin Kaya", "investor", "Individual investor", None),
    ("caspian-solar", "Caspian Solar Holdings", "producer", "Solar producer", "solarProducer"),
    ("absheron-wind", "Absheron Wind Energy", "producer", "Wind producer", "windProducer"),
    ("signer-risk", "Leyla Hasanova", "signer", "Chief Risk Officer", 0),
    ("signer-compliance", "Murat Demir", "signer", "Compliance Officer", 1),
    ("signer-cto", "Elvin Aliyev", "signer", "Chief Technology Officer", 2),
]
AYLIN_STARTING_USDC = 10_000
# Aylin already holds ~$8,000 across four assets (token id -> shares), so payouts are visible
AYLIN_PORTFOLIO = {1: 300, 5: 250, 6: 150, 4: 100}


def seed_personas(s: Session) -> None:
    accounts = chain().deployment["accounts"]
    for key, name, role, title, source in PERSONAS:
        if s.scalar(select(User).where(User.persona == key)):
            continue
        user = User(name=name, email=f"{key}@demo.ecofraction.az", role=role, persona=key, title=title)
        if source is None:
            user.wallet_address, user.wallet_key_enc = new_wallet()
        else:
            entry = accounts["multisigSigners"][source] if role == "signer" else accounts[source]
            user.wallet_address, user.wallet_index = entry["address"], entry["index"]
            user.kyc_status = "verified" if role == "producer" else "none"
        s.add(user)
        s.flush()
        if role == "investor":
            verify_kyc(s, user)
            approve_platform_contracts(user)
            deposit(s, user, AYLIN_STARTING_USDC, method="seed")
            seed_portfolio(s, user, AYLIN_PORTFOLIO)
    s.commit()


def backfill_history(s: Session, asset: Asset, until_hour: datetime, hours: int = 48) -> None:
    """Pre-demo operating history so forecasts and charts have context from the first minute."""
    rng = random.Random(5000 + asset.token_id)
    model = SolarModel(asset, rng) if asset.kind == "solar" else WindModel(asset, rng)
    start = until_hour - timedelta(hours=hours)
    for h in range(hours):
        hour = start + timedelta(hours=h)
        energy = 0.0
        for k in range(12):
            r = model.step(hour + timedelta(minutes=5 * (k + 1)), 300)
            energy += r["power_kw"] * 300 / 3600
        s.add(HourlyEnergy(asset_id=asset.id, hour=hour.isoformat(timespec="seconds"), energy_kwh=round(energy, 1),
                           ratio=energy / asset.capacity_kw, backfilled=True))
    s.commit()
