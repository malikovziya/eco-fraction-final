"""Settlement worker: anchors each closed batch on-chain, collects the grid payment,
and pushes USDC payouts to every holder (or leaves flagged revenue in escrow)."""

import queue
import threading
from datetime import datetime

from sqlalchemy import select

from ..chain import chain, from_usdc, tx_hex
from ..db import Activity, Batch, SessionLocal, User
from ..hub import hub


class Settlement:
    def __init__(self):
        self.jobs: queue.Queue[int] = queue.Queue()

    def start(self) -> None:
        threading.Thread(target=self._run, name="settlement", daemon=True).start()

    def submit(self, batch_id: int) -> None:
        self.jobs.put(batch_id)

    def _run(self) -> None:
        while True:
            batch_id = self.jobs.get()
            try:
                self._settle(batch_id)
            except Exception as e:
                print(f"[settlement] batch {batch_id} failed: {e!r}", flush=True)
                with SessionLocal() as s:
                    s.get(Batch, batch_id).status = "failed"
                    s.commit()

    def _settle(self, batch_id: int) -> None:
        c = chain()
        oracle, distributor = c.c["oracle"], c.c["distributor"]
        with SessionLocal() as s:
            b = s.get(Batch, batch_id)
            start = int(datetime.fromisoformat(b.period_start).timestamp())
            end = int(datetime.fromisoformat(b.period_end).timestamp())

            record = c.send(c.platform, oracle.functions.recordBatch(
                b.token_id, start, end, b.energy_wh, bytes.fromhex(b.data_hash), b.anomaly_score, b.flagged))
            b.chain_batch_id = c.events("oracle", "BatchRecorded", record)[0]["args"]["batchId"]
            b.tx_record = tx_hex(record)

            settle = c.send(c.platform, distributor.functions.settle(b.chain_batch_id))
            b.revenue_usdc = from_usdc(c.events("distributor", "BatchSettled", settle)[0]["args"]["amount"])
            b.tx_settle = tx_hex(settle)
            b.status = "escrowed" if b.flagged else "distributed"
            s.commit()

            paid = self.pay_holders(s, b.token_id, b.asset_id)
            if paid:
                b.tx_payout = paid
            s.commit()
            hub.publish("batch_settled", {
                "id": b.id, "asset_id": b.asset_id, "status": b.status, "revenue_usdc": b.revenue_usdc,
                "chain_batch_id": b.chain_batch_id, "tx_record": b.tx_record, "tx_settle": b.tx_settle,
                "tx_payout": b.tx_payout,
            })

    @staticmethod
    def pay_holders(s, token_id: int, asset_id: str) -> str | None:
        """Push all claimable revenue for an asset to every platform wallet holding it."""
        c = chain()
        # Background investors' revenue accrues on-chain (claimable); push only to interactive users
        users = s.scalars(select(User).where(User.synthetic.is_(False))).all()
        addresses = [u.wallet_address for u in users]
        balances = c.c["token"].functions.balanceOfBatch(addresses, [token_id] * len(addresses)).call()
        holders = [u for u, bal in zip(users, balances) if bal > 0]
        if not holders:
            return None
        receipt = c.send(c.platform, c.c["distributor"].functions.payout(token_id, [u.wallet_address for u in holders]))
        by_address = {u.wallet_address.lower(): u for u in holders}
        for ev in c.events("distributor", "RevenuePaid", receipt):
            user = by_address[ev["args"]["account"].lower()]
            amount = from_usdc(ev["args"]["amount"])
            s.add(Activity(user_id=user.id, kind="payout", asset_id=asset_id, amount_usdc=amount,
                           tx_hash=tx_hex(receipt)))
            hub.publish("payout", {"user_id": user.id, "asset_id": asset_id, "amount_usdc": amount,
                                   "tx_hash": tx_hex(receipt)})
        return tx_hex(receipt)


settlement = Settlement()
