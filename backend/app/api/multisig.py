"""2-of-3 multisig governance: review escrowed batches, propose and approve decisions."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..chain import TxFailed, chain, tx_hex
from ..db import Alert, Batch, User
from ..hub import hub
from ..services.settlement import Settlement
from ..wallets import signer_for
from .deps import get_db, require_role

router = APIRouter(prefix="/api/multisig")

ACTIONS = {"release": "releaseEscrow", "refund": "refundEscrow"}


def _decode(proposal) -> dict:
    target, value, data, description, executed, approvals = proposal
    c = chain()
    name = c.names.get(target.lower())
    fn = None
    if name:
        try:
            func_obj, params = c.c[name].decode_function_input(data)
            fn = {"name": func_obj.fn_name, "params": dict(params)}
        except Exception:
            pass
    return {"target": name or target, "function": fn, "description": description,
            "executed": executed, "approvals": approvals}


@router.get("/proposals")
def proposals() -> dict:
    c = chain()
    ms = c.c["multisig"]
    count = ms.functions.proposalCount().call()
    owners = ms.functions.getOwners().call()
    out = []
    for i in reversed(range(count)):
        d = _decode(ms.functions.getProposal(i).call())
        d["id"] = i
        d["approved_by"] = [o for o in owners if ms.functions.approved(i, o).call()]
        out.append(d)
    return {"threshold": ms.functions.threshold().call(), "owners": owners, "proposals": out}


class ProposeIn(BaseModel):
    batch_id: int
    action: str  # release | refund
    note: str = ""


@router.post("/propose")
def propose(body: ProposeIn, user: User = Depends(require_role("signer")), s: Session = Depends(get_db)) -> dict:
    b = s.get(Batch, body.batch_id)
    if b is None or b.status != "escrowed":
        raise HTTPException(400, "Batch is not in escrow")
    if body.action not in ACTIONS:
        raise HTTPException(400, "Action must be release or refund")
    c = chain()
    data = c.c["distributor"].encode_abi(ACTIONS[body.action], args=[b.chain_batch_id])
    label = "Release to investors" if body.action == "release" else "Refund grid buyer"
    description = f"{label}: batch #{b.id} ({b.asset_id}, {b.period_start[11:16]}). {body.note}".strip()
    try:
        receipt = c.send(signer_for(user), c.c["multisig"].functions.propose(
            c.c["distributor"].address, 0, data, description))
    except TxFailed:
        raise HTTPException(400, "Proposal reverted")
    proposal_id = c.events("multisig", "Proposed", receipt)[0]["args"]["id"]
    hub.publish("multisig", {"proposal_id": proposal_id, "event": "proposed", "by": user.name})
    return {"proposal_id": proposal_id, "tx_hash": tx_hex(receipt)}


class ApproveIn(BaseModel):
    proposal_id: int


@router.post("/approve")
def approve(body: ApproveIn, user: User = Depends(require_role("signer")), s: Session = Depends(get_db)) -> dict:
    c = chain()
    try:
        receipt = c.send(signer_for(user), c.c["multisig"].functions.approve(body.proposal_id))
    except TxFailed:
        raise HTTPException(400, "Approval reverted (already approved or executed?)")
    executed = bool(c.events("multisig", "Executed", receipt))
    if executed:
        _apply_outcome(s, receipt)
    hub.publish("multisig", {"proposal_id": body.proposal_id, "event": "executed" if executed else "approved",
                             "by": user.name})
    return {"tx_hash": tx_hex(receipt), "executed": executed}


def _apply_outcome(s: Session, receipt) -> None:
    """Mirror the executed escrow decision into the database and pay released revenue out."""
    c = chain()
    for event, status in (("EscrowReleased", "released"), ("EscrowRefunded", "refunded")):
        for ev in c.events("distributor", event, receipt):
            b = s.scalar(select(Batch).where(Batch.chain_batch_id == ev["args"]["batchId"]))
            if b is None:
                continue
            b.status = status
            for alert in s.scalars(select(Alert).where(Alert.batch_id == b.id, Alert.kind == "fraud")):
                alert.active = False
            s.commit()
            if status == "released":
                Settlement.pay_holders(s, b.token_id, b.asset_id)
                s.commit()
            hub.publish("batch_settled", {"id": b.id, "asset_id": b.asset_id, "status": status})
