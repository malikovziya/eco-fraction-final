# Smart Contract Security Scan

Team VoltLedger · Eco-Fraction · Pre-audit evidence for the "Blockchain technical risk" row of our risk table

---

## Summary

We scanned all 8 Eco-Fraction smart contracts with **Slither 0.11.6**, the industry-standard open-source static analyzer for Solidity (by Trail of Bits). Slither runs **102 detectors** for known vulnerability patterns: reentrancy, unprotected functions, unchecked transfers, dangerous calls and more. OpenZeppelin library code was excluded, because it is already professionally audited.

| | Findings |
|---|---|
| First scan | 13 |
| Improved in the code | 4 |
| Remaining, reviewed and explained below | 9 |
| **Real vulnerabilities** | **0** |

**What this is and isn't.** A static scan is strong evidence, not a replacement for an independent audit. An audit by a specialist firm remains on the roadmap, before any mainnet launch with real money.

**How to reproduce:**

```
pip install slither-analyzer
cd contracts
slither . --filter-paths node_modules
```

---

## What we improved (4)

| Finding | Change |
|---|---|
| The grid buyer's address had no "not empty" check | `RevenueDistributor` now refuses an empty address at deployment |
| The grid buyer, minimum investment and treasury address never change, but weren't marked as fixed | All three are now `immutable`: guaranteed unchangeable by the code itself, and cheaper to read |

All 22 contract tests and the end-to-end platform test pass after these changes.

---

## Reviewed and accepted (9)

| Severity (scanner) | Finding | Why it is safe |
|---|---|---|
| High | `settle()` pulls USDC from an address that is not the caller | **By design.** It works like a direct debit: the grid buyer pays for verified energy. Only the platform's keeper role can call it, and only for a batch already recorded on-chain; the amount is energy × tariff. See the production note below |
| Medium (×2) | `PrimaryMarket` ignores some values returned by `token.assets()` | We read one field of the asset record (price or producer) and deliberately skip the others |
| Low (×4) | External calls inside a loop | The loops only call **our own** contracts (the share token and the revenue distributor), never untrusted code. The payout loop is keeper-controlled and batched |
| Low | MultiSig emits its `Executed` event after the external call | State is updated **before** the call (`executed = true`), which is the safe checks-effects-interactions order. Only the log event comes after |
| Info | MultiSig uses a low-level `call` | Required: a multisig must be able to execute any approved action on any contract. The result is checked and a failure reverts |

---

## Production note: limit the grid buyer's allowance

In the demo, the grid buyer approves the revenue contract for an **unlimited** amount. In production this should be a **periodic spending limit**, like a direct-debit cap (for example, one month of expected energy). Then even a stolen platform key could only move a bounded amount. It's a deployment setting; the contract code doesn't change.

---

## Other security controls already in place

- **2-of-3 multisig** holds every admin power (escrow release and refund, pause, fee, tariff). The deployer renounces all roles after setup, and a smoke test checks this.
- **Role separation**: the platform key can only record batches, settle, pay out, approve KYC and mint test USDC. It cannot move escrowed money.
- **Pause switch** on share transfers, and a **KYC whitelist** on every transfer.
- **Fee bounds** of 0.5–1.5%, enforced in code.
- **ReentrancyGuard** on every function that moves money.
- **OpenZeppelin 5**: audited building blocks for ERC-1155, access control and safe transfers.
