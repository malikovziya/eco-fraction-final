"""Custodial wallets: every user gets a real on-chain account the platform signs for."""

from eth_account import Account
from eth_account.signers.local import LocalAccount
from sqlalchemy.orm import Session
from web3 import Web3

from .chain import chain, to_usdc, tx_hex
from .config import GAS_FUNDING_ETH
from .db import Activity, User
from .security import decrypt_key, encrypt_key


def new_wallet() -> tuple[str, str]:
    """Create a wallet and give it gas money. Returns (address, encrypted private key)."""
    acct = Account.create()
    c = chain()
    c.send(c.platform, to=acct.address, value=Web3.to_wei(GAS_FUNDING_ETH, "ether"))
    return acct.address, encrypt_key(acct.key.hex())


def signer_for(user: User) -> LocalAccount:
    if user.wallet_index is not None:
        return chain().dev_account(user.wallet_index)
    return Account.from_key(decrypt_key(user.wallet_key_enc))


def approve_platform_contracts(user: User) -> None:
    """One-time approvals so buying and trading need a single transaction each."""
    c = chain()
    acct = signer_for(user)
    max_uint = 2**256 - 1
    for spender in ("primary", "market"):
        c.send(acct, c.c["usdc"].functions.approve(c.c[spender].address, max_uint))
    c.send(acct, c.c["token"].functions.setApprovalForAll(c.c["market"].address, True))


def verify_kyc(s: Session, user: User) -> str:
    c = chain()
    receipt = c.send(c.platform, c.c["kyc"].functions.verify(user.wallet_address))
    user.kyc_status = "verified"
    s.add(Activity(user_id=user.id, kind="kyc", tx_hash=tx_hex(receipt), detail={"status": "verified"}))
    return tx_hex(receipt)


def deposit(s: Session, user: User, amount: float, method: str = "bank_transfer", detail: dict | None = None) -> str:
    """Fiat on-ramp: the platform mints test USDC 1:1 for the deposited amount."""
    c = chain()
    receipt = c.send(c.platform, c.c["usdc"].functions.mint(user.wallet_address, to_usdc(amount)))
    s.add(Activity(user_id=user.id, kind="deposit", amount_usdc=amount, tx_hash=tx_hex(receipt),
                   detail={"method": method, **(detail or {})}))
    return tx_hex(receipt)
