"""Blockchain client: contract handles, platform accounts and serialized transaction sending."""

import json
import threading
from collections import defaultdict
from functools import cached_property

from eth_account import Account
from eth_account.signers.local import LocalAccount
from web3 import Web3
from web3.contract import Contract

from .config import CHAIN_ID, CHAIN_RPC, DEPLOYMENT_FILE, DEV_MNEMONIC

Account.enable_unaudited_hdwallet_features()

USDC_DECIMALS = 6


def to_usdc(amount: float) -> int:
    return int(round(amount * 10**USDC_DECIMALS))


def from_usdc(raw: int) -> float:
    return raw / 10**USDC_DECIMALS


class TxFailed(Exception):
    pass


class Chain:
    def __init__(self):
        self.w3 = Web3(Web3.HTTPProvider(CHAIN_RPC, request_kwargs={"timeout": 30}))
        self.deployment = json.loads(DEPLOYMENT_FILE.read_text())
        self.c: dict[str, Contract] = {
            key: self.w3.eth.contract(address=v["address"], abi=v["abi"])
            for key, v in self.deployment["contracts"].items()
        }
        self._locks: dict[str, threading.Lock] = defaultdict(threading.Lock)
        # Contract address -> friendly name, for the transaction explorer
        self.names = {v["address"].lower(): key for key, v in self.deployment["contracts"].items()}

    # ── Accounts ────────────────────────────────────────────────────────────

    @staticmethod
    def dev_account(index: int) -> LocalAccount:
        return Account.from_mnemonic(DEV_MNEMONIC, account_path=f"m/44'/60'/0'/0/{index}")

    @cached_property
    def platform(self) -> LocalAccount:
        """Oracle, keeper, KYC verifier and fiat on-ramp minter."""
        return self.dev_account(self.deployment["accounts"]["platform"]["index"])

    def role_account(self, role: str) -> LocalAccount:
        return self.dev_account(self.deployment["accounts"][role]["index"])

    # ── Transactions ────────────────────────────────────────────────────────

    def send(self, account: LocalAccount, fn=None, *, to: str | None = None, value: int = 0):
        """Sign, send and wait for a transaction. One in flight per sender keeps nonces correct."""
        with self._locks[account.address]:
            base = {
                "from": account.address,
                "nonce": self.w3.eth.get_transaction_count(account.address, "pending"),
                "chainId": CHAIN_ID,
                "value": value,
            }
            if fn is not None:
                tx = fn.build_transaction(base)
            else:
                tx = {**base, "to": to, "gas": 21_000,
                      "maxFeePerGas": self.w3.eth.gas_price * 2, "maxPriorityFeePerGas": 0}
            signed = account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=30)
        if receipt.status != 1:
            raise TxFailed(f"transaction {tx_hash.hex()} reverted")
        return receipt

    def events(self, contract: str, event: str, receipt) -> list:
        from web3.logs import DISCARD

        return list(getattr(self.c[contract].events, event)().process_receipt(receipt, errors=DISCARD))


_chain: Chain | None = None


def chain() -> Chain:
    global _chain
    if _chain is None:
        _chain = Chain()
    return _chain


def tx_hex(receipt) -> str:
    h = receipt["transactionHash"].hex()
    return h if h.startswith("0x") else "0x" + h
