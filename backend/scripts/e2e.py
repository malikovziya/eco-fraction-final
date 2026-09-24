"""End-to-end check of the running platform (all services up via start.ps1).

Run:  .venv\\Scripts\\python backend\\scripts\\e2e.py
"""

import sys
import time

import httpx

sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252

API = "http://127.0.0.1:8100/api"
http = httpx.Client(base_url=API, timeout=60)


def login(persona: str) -> dict:
    token = http.post("/auth/persona", json={"persona": persona}).raise_for_status().json()["token"]
    return {"Authorization": f"Bearer {token}"}


def wait_for(predicate, what: str, timeout: float = 90):
    start = time.time()
    while time.time() - start < timeout:
        result = predicate()
        if result:
            return result
        time.sleep(2)
    sys.exit(f"✘ timed out waiting for {what}")


def ok(msg: str) -> None:
    print(f"✔ {msg}", flush=True)


def main() -> None:
    http.post("/sim/clear")

    # 1. Investor buys $50 of Gobustan Solar
    aylin = login("aylin")
    before = http.get("/portfolio", headers=aylin).json()
    r = http.post("/invest", headers=aylin, json={"asset_id": "khizi-wind", "shares": 5}).raise_for_status().json()
    ok(f"Aylin bought 5 Khizi Wind shares for ${r['cost_usdc']} (fee ${r['fee_usdc']}) tx {r['tx_hash'][:12]}…")
    r = http.post("/invest", headers=aylin, json={"asset_id": "gobustan-solar", "shares": 4})
    assert r.status_code == 400, r.text
    ok(f"$40 purchase rejected: {r.json()['detail']}")

    # 2. Revenue reaches her wallet automatically
    def earned():
        p = http.get("/portfolio", headers=aylin).json()
        return p if p["total_earned_usdc"] > before["total_earned_usdc"] else None
    p = wait_for(earned, "first payout")
    ok(f"auto-payout received: ${p['total_earned_usdc']:.6f} USDC, projected ${p['projected_annual_income_usdc']}/yr")

    # 3. Meter fraud on Khizi Wind -> AI flags -> escrow
    http.post("/sim/fault", json={"asset_id": "khizi-wind", "fault": "inflate", "on": True})
    flagged = wait_for(lambda: next(iter(http.get("/batches", params={"asset_id": "khizi-wind", "flagged": True}).json()), None),
                       "flagged batch")
    http.post("/sim/fault", json={"asset_id": "khizi-wind", "fault": "inflate", "on": False})
    ok(f"AI flagged batch #{flagged['id']} as '{flagged['verdict']}' "
       f"({flagged['suspicious_readings']}/{flagged['readings']} readings, score {flagged['anomaly_score']:.2f})")
    for f in flagged["explanation"]:
        print(f"    · {f['label']}: {f['value']} (SHAP +{f['contribution']})")
    batch = wait_for(lambda: (b := http.get(f"/batches/{flagged['id']}").json())["status"] == "escrowed" and b,
                     "escrow settlement")
    ok(f"${batch['revenue_usdc']:.2f} held in on-chain escrow")

    # 4. Hash anchored on-chain matches the stored signed readings
    v = http.get(f"/batches/{flagged['id']}/verify").json()
    assert v["match"], v
    ok(f"batch hash verified against chain: {v['onchain_hash'][:18]}… ({v['readings']} signed readings)")

    # 5. Multisig: risk officer proposes release, CTO approves -> executes
    risk, cto = login("signer-risk"), login("signer-cto")
    prop = http.post("/multisig/propose", headers=risk,
                     json={"batch_id": flagged["id"], "action": "release", "note": "test"}).raise_for_status().json()
    res = http.post("/multisig/approve", headers=cto, json={"proposal_id": prop["proposal_id"]}).raise_for_status().json()
    assert res["executed"]
    ok(f"2-of-3 multisig executed proposal #{prop['proposal_id']}: batch status "
       f"{http.get(f'/batches/{flagged['id']}').json()['status']}")

    # 6. Forged device is blocked at the bridge
    http.post("/sim/fault", json={"asset_id": "absheron-wind", "fault": "forge", "on": True})
    rej = wait_for(lambda: next(iter(http.get("/rejections").json()), None), "rejection")
    http.post("/sim/fault", json={"asset_id": "absheron-wind", "fault": "forge", "on": False})
    ok(f"forged device blocked: {rej['asset_id']} claimed {rej['claimed_power_kw']} kW ({rej['reason']})")

    # 7. Degradation -> maintenance alert, revenue still paid
    http.post("/sim/fault", json={"asset_id": "absheron-wind", "fault": "degrade", "on": True})
    alert = wait_for(lambda: next((a for a in http.get("/alerts", params={"active": True}).json()
                                   if a["kind"] == "maintenance"), None), "maintenance alert", timeout=180)
    http.post("/sim/fault", json={"asset_id": "absheron-wind", "fault": "degrade", "on": False})
    ok(f"maintenance alert: {alert['title']}")

    # 8. Explorer decodes a transaction
    tx = http.get(f"/chain/tx/{batch['tx_settle']}").json()
    ok(f"explorer: {tx['to_contract']}.{tx['function']['name']}() -> events {[e['event'] for e in tx['events']]}")

    # 9. New user: signup -> KYC -> deposit -> invest
    email = f"judge{int(time.time())}@example.com"
    t = http.post("/auth/signup", json={"name": "Test Judge", "email": email, "password": "secret123"}).raise_for_status().json()
    judge = {"Authorization": f"Bearer {t['token']}"}
    assert http.post("/invest", headers=judge, json={"asset_id": "gobustan-solar", "shares": 5}).status_code == 403
    http.post("/kyc", headers=judge, json={"full_name": "Test Judge", "national_id": "AZE1234567",
                                           "country": "AZ", "birth_date": "1990-01-01"}).raise_for_status()
    http.post("/wallet/deposit", headers=judge, json={"amount": 100, "bank": "Demo Bank"}).raise_for_status()
    http.post("/invest", headers=judge, json={"asset_id": "gobustan-solar", "shares": 5}).raise_for_status()
    ok(f"new user {email}: blocked before KYC, then KYC → deposit $100 → bought 5 shares")

    # 10. Secondary market: Aylin lists, the judge buys part of it
    lst = http.post("/market/list", headers=aylin, json={"asset_id": "gobustan-solar", "shares": 20, "price_usdc": 10.4}).raise_for_status().json()
    http.post("/wallet/deposit", headers=judge, json={"amount": 500}).raise_for_status()
    fill = http.post("/market/buy", headers=judge, json={"listing_id": lst["listing_id"], "shares": 8}).raise_for_status().json()
    ok(f"marketplace: listed 20 @ $10.40, judge bought 8 for ${fill['cost_usdc']} (fee ${fill['fee_usdc']})")
    http.post("/market/cancel", headers=aylin, json={"listing_id": lst["listing_id"]}).raise_for_status()

    # 11. Open Banking: consent -> OTP -> on-chain deposit and withdrawal
    for kind, amount in (("deposit", 250), ("withdraw", 100)):
        c = http.post("/banking/consents", headers=judge, json={"bank_id": "caspian", "type": kind, "amount": amount}).raise_for_status().json()
        assert http.post(f"/banking/consents/{c['consent_id']}/authorize", headers=judge, json={"otp": "000000"}).status_code == 401
        r = http.post(f"/banking/consents/{c['consent_id']}/authorize", headers=judge, json={"otp": c["sandbox_otp"]}).raise_for_status().json()
        ok(f"open banking {kind} ${amount}: wrong OTP refused, then settled ref {r['reference']} tx {r['tx_hash'][:12]}…")

    # 12. Producer dashboard + report, economics
    prod = login("absheron-wind")
    ov = http.get("/producer/overview", headers=prod).raise_for_status().json()
    http.get("/producer/report/khizi-wind", headers=prod).raise_for_status()
    econ = http.get("/platform/economics").json()
    ok(f"producer raised ${ov['raised_total_usdc']:,.0f} from {ov['investors_total']} investors; treasury ${econ['live']['treasury_usdc']:,.2f}")

    esg = http.get("/assets/khizi-wind/esg").json()
    ok(f"Khizi ESG {esg['score']} ({esg['rating']}): E {esg['pillars']['E']['score']} "
       f"S {esg['pillars']['S']['score']} G {esg['pillars']['G']['score']}")
    print("\nAll end-to-end checks passed.")


if __name__ == "__main__":
    main()
