"""Background market activity: seeded retail investors and a steady trickle of new purchases,
so offerings show realistic funding progress and the platform feels alive during the demo.

Every participant is a real on-chain wallet with KYC, USDC and shares. Their revenue accrues
on-chain (claimable); the keeper only pushes payouts to interactive users each cycle.
"""

import random
import threading
import time

from eth_account import Account
from sqlalchemy import func, select
from web3 import Web3

from ..chain import chain, from_usdc, to_usdc, tx_hex
from ..config import BACKGROUND_INVESTORS, TRICKLE_INVEST_SECONDS
from ..db import Activity, SessionLocal, User
from ..hub import hub
from ..security import encrypt_key
from ..state import platform

FIRST = ["Aysel", "Nigar", "Elvin", "Murad", "Leyla", "Kamran", "Zeynep", "Emre", "Günay", "Rashad", "Selin", "Orxan",
         "Aytac", "Tural", "Merve", "Farid", "Sevinc", "Burak", "Nurlan", "Ceren", "Ilkin", "Aynur", "Kerem", "Samir",
         "Lale", "Anar", "Ebru", "Vugar", "Deniz", "Nijat"]
LAST = "ABCDEFGHIKLMNOPRSTUVYZ"
# Popularity of each asset with retail investors (token id -> weight)
WEIGHTS = {1: 5, 2: 3, 3: 2, 4: 4, 5: 3, 6: 3}
# Fictional institutional investors (the report's "small funds" segment) that anchor each offering
FUNDS = ["Green Horizon Fund", "Caspian Impact Capital", "Anatolia ESG Partners", "Silkway Climate Fund",
         "Nexa Sustainable Income"]


class Market:
    def __init__(self):
        self.rng = random.Random(42)
        self.ready = False

    def start(self) -> None:
        threading.Thread(target=self._run, name="market", daemon=True).start()

    def _run(self) -> None:
        try:
            with SessionLocal() as s:
                existing = s.scalar(select(func.count()).select_from(User).where(User.synthetic)) or 0
                funds_done = s.scalar(select(func.count()).select_from(User).where(
                    User.synthetic, User.title == "Institutional investor")) or 0
            if not funds_done:
                self._seed_funds()
            for _ in range(existing, BACKGROUND_INVESTORS):
                self._safely(announce=False)
            self.ready = True
            print(f"[market] {BACKGROUND_INVESTORS} background investors active", flush=True)
            while True:
                time.sleep(self.rng.uniform(0.6, 1.4) * TRICKLE_INVEST_SECONDS)
                self._safely(announce=True)
        except Exception as e:
            print(f"[market] stopped: {e!r}", flush=True)

    def _seed_funds(self) -> None:
        """Anchor investors take 25–65% of each offering, like cornerstone investors in a real raise."""
        c = chain()
        offered = {a["tokenId"]: a["offeredShares"] for a in c.deployment["assets"]}
        targets = {t: self.rng.uniform(0.25, 0.65) for t in offered}
        for i, name in enumerate(FUNDS):
            acct = Account.create()
            c.w3.provider.make_request("anvil_setBalance", [acct.address, hex(Web3.to_wei(1, "ether"))])
            c.send(c.platform, c.c["kyc"].functions.verify(acct.address))
            # Each fund participates in three offerings, splitting that asset's target with the other funds
            portfolio = {t: int(offered[t] * targets[t] / 2.5) for t in list(offered)[i % 6:] + list(offered)[:i % 6]}
            portfolio = dict(list(portfolio.items())[:3])
            budget = sum(portfolio.values()) * 10
            c.send(c.platform, c.c["usdc"].functions.mint(acct.address, to_usdc(budget)))
            c.send(acct, c.c["usdc"].functions.approve(c.c["primary"].address, 2**256 - 1))
            with SessionLocal() as s:
                user = User(name=name, email=f"fund-{i}@demo.ecofraction.az", role="investor",
                            title="Institutional investor", wallet_address=acct.address,
                            wallet_key_enc=encrypt_key(acct.key.hex()), kyc_status="verified", synthetic=True)
                s.add(user)
                s.flush()
                for token_id, shares in portfolio.items():
                    receipt = c.send(acct, c.c["primary"].functions.buy(token_id, shares))
                    s.add(Activity(user_id=user.id, kind="buy", asset_id=platform().by_token[token_id].id,
                                   shares=shares, amount_usdc=shares * 10, tx_hash=tx_hex(receipt)))
                s.commit()
        print(f"[market] {len(FUNDS)} institutional anchor investors seeded", flush=True)

    def _safely(self, announce: bool) -> None:
        try:
            self._new_investor(announce)
        except Exception as e:  # one failed investor must not stop the market
            print(f"[market] skipped an investor: {e!r}", flush=True)

    def _new_investor(self, announce: bool) -> None:
        c = chain()
        acct = Account.create()
        name = f"{self.rng.choice(FIRST)} {self.rng.choice(LAST)}."
        # Local-chain faucet for gas (no transaction needed on the dev chain)
        c.w3.provider.make_request("anvil_setBalance", [acct.address, hex(Web3.to_wei(1, "ether"))])
        c.send(c.platform, c.c["kyc"].functions.verify(acct.address))
        # Retail ticket sizes: many small, a few large (log-normal around ~$400)
        budget = min(20_000, max(50, round(self.rng.lognormvariate(6.0, 0.9) / 10) * 10))
        c.send(c.platform, c.c["usdc"].functions.mint(acct.address, to_usdc(budget)))
        c.send(acct, c.c["usdc"].functions.approve(c.c["primary"].address, 2**256 - 1))

        picks = self.rng.choices(list(WEIGHTS), weights=list(WEIGHTS.values()), k=self.rng.choice((1, 1, 2)))
        tokens = list(dict.fromkeys(picks))[: max(1, int(budget // 50))]  # every purchase must meet the $50 minimum
        shares = int(budget // len(tokens) // 10)
        with SessionLocal() as s:
            user = User(name=name, email=f"investor-{acct.address[2:10].lower()}@demo.ecofraction.az",
                        role="investor", title="Individual investor", wallet_address=acct.address,
                        wallet_key_enc=encrypt_key(acct.key.hex()), kyc_status="verified", synthetic=True)
            s.add(user)
            s.flush()
            for token_id in tokens:
                receipt = c.send(acct, c.c["primary"].functions.buy(token_id, shares))
                asset = platform().by_token[token_id]
                s.add(Activity(user_id=user.id, kind="buy", asset_id=asset.id, shares=shares,
                               amount_usdc=shares * 10, tx_hash=tx_hex(receipt)))
                if announce:
                    hub.publish("investment", {"name": name, "asset_id": asset.id, "asset_name": asset.name,
                                               "shares": shares, "amount_usdc": shares * 10,
                                               "tx_hash": tx_hex(receipt)})
            s.commit()


def seed_portfolio(s, user: User, allocations: dict[int, int]) -> None:
    """Buy an initial position for a persona: token id -> shares."""
    from ..wallets import signer_for

    c = chain()
    acct = signer_for(user)
    for token_id, shares in allocations.items():
        cost, fee = c.c["primary"].functions.quote(token_id, shares).call()
        receipt = c.send(acct, c.c["primary"].functions.buy(token_id, shares))
        s.add(Activity(user_id=user.id, kind="buy", asset_id=platform().by_token[token_id].id, shares=shares,
                       amount_usdc=from_usdc(cost), tx_hash=tx_hex(receipt), detail={"fee_usdc": from_usdc(fee)}))


market = Market()
