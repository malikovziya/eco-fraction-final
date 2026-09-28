# Eco-Fraction: Complete Project Guide

Everything the team needs to know to explain the platform to the jury: what it does, how every part works, and why we built it this way.

Team VoltLedger · Teknofest Financial Technologies Competition

---

## Contents

1. The project in 60 seconds
2. What is real, what is local, what is simulated
3. The big picture: architecture
4. The journey of one sensor reading
5. The journey of one hour: batch, AI verdict, chain, payout
6. Layer by layer
   - 6.1 Physical layer: sensor simulator
   - 6.2 Data layer: MQTT, bridge, Kafka
   - 6.3 Intelligence layer: XGBoost, LSTM, ESG
   - 6.4 Blockchain layer: the 8 smart contracts
   - 6.5 Financial layer: payouts, escrow, Open Banking
   - 6.6 User layer: the web app
7. Economics and numbers
8. Users, wallets and accounts
9. Demo data: what is generated and why
10. Infrastructure and how it runs
11. Testing and quality evidence
12. Decision log
13. Known limitations and honest answers
14. Glossary

---

## 1. The project in 60 seconds

**Problem.** The world needs about $5 trillion of renewable energy investment by 2030 (IEA), but individuals are locked out: a direct stake in a solar or wind plant usually needs $100,000 or more. Production data is hidden in closed systems, the capital is locked for years, and "green" claims are rarely verifiable.

**Solution.** Eco-Fraction splits real renewable plants in Azerbaijan into **$10 digital shares** (ERC-1155 tokens), with a **$50 minimum investment**. Four things happen automatically:

1. **Measure.** Every sensor signs each reading with its own cryptographic key (Ed25519).
2. **Verify.** An AI model (XGBoost) checks every reading against physics. For example, a meter can't report more power than the measured wind speed allows.
3. **Record.** Every hour, a fingerprint (SHA-256 hash) of that hour's readings is written to the blockchain, together with the AI verdict.
4. **Earn.** The grid buyer pays for the verified energy in USDC, and a smart contract distributes it to all shareholders automatically.

**The key idea to repeat to the jury:** *unverified revenue is never distributed.* If the AI suspects manipulation, that hour's revenue is locked in an on-chain escrow until two of three human signers (a multisig) decide to release it or refund it.

---

## 2. What is real, what is local, what is simulated

Always be transparent about this. It builds trust.

| Part | Status | What that means |
|---|---|---|
| MQTT broker, Kafka stream, signature checks | **Real, running** | Mosquitto and Redpanda (Kafka-compatible) run in Docker; every message is really verified |
| XGBoost and LSTM models | **Real models** | Trained by us, but on *simulated* data |
| 8 smart contracts | **Real code, 22 tests** | Run on a local blockchain; optional deploy to the public Polygon Amoy testnet |
| Revenue distribution, escrow, multisig | **Real, on-chain** | Real transactions, visible in our block explorer |
| IoT sensors | **Simulated** | A physics-based simulator produces realistic readings |
| USDC | **Test token** | Behaves like USDC (6 decimals) but has no real value |
| Banks (Open Banking), KYC checks | **Sandbox** | Fictional banks and a simulated KYC; the resulting wallet approval is a real transaction |
| Assets, investors, funds | **Demo data** | Fictional names; realistic locations, sizes and economics |

---

## 3. The big picture: architecture

It follows Figure 1 of our preliminary report exactly:

```
[Physical Layer]      6 simulated smart meters, each with its own Ed25519 key
        │  MQTT (signed JSON messages)
[Data Layer]          Bridge verifies signatures  →  Kafka topics
        │             telemetry.verified   /   telemetry.rejected
[Intelligence Layer]  XGBoost scores every reading · LSTM forecasts · ESG engine
        │  hourly batch: energy + data hash + AI verdict
[Blockchain Layer]    EnergyOracle · RevenueDistributor · AssetToken · MultiSig …
        │  grid buyer pays kWh × $0.05 in USDC
[Financial Layer]     automatic payouts · escrow · Open Banking deposits/withdrawals
        │  WebSocket (live events)
[User Layer]          investor, producer and governance dashboards (Next.js)
```

**Code map:**

| Folder | What lives there |
|---|---|
| `iot/` | Simulator, physics models, device keys, MQTT→Kafka bridge |
| `backend/` | FastAPI server: AI, ESG, blockchain integration, all APIs |
| `contracts/` | Solidity contracts, tests, deploy scripts |
| `frontend/` | Next.js web app |
| `shared/assets.json` | The 6 assets, the single source of truth for every layer |
| `infra/` | Docker setup: MQTT, Kafka, local blockchain |
| `docs/` | Run-sheet, jury Q&A, this guide |

---

## 4. The journey of one sensor reading

Follow one reading from Khizi Wind Farm:

1. **The simulator generates a reading.** Every real second, the simulated clock advances 5 minutes. The wind model produces a wind speed; the turbine power curve turns it into power (e.g. 145 MW).
2. **The device signs it.** The message contains the device ID, asset, sequence number, boot ID, simulated timestamp, power, energy, wind speed and temperature. It's signed with the device's private Ed25519 key.
3. **It's published over MQTT** to the topic `ecofraction/telemetry/khizi-wind`.
4. **The bridge verifies it.** The bridge plays the role AWS IoT Core would play in production. It checks, in order:
   - Is the device registered? If not: `unknown_device`.
   - Does the device belong to this asset? If not: `asset_mismatch`.
   - Is the signature valid for the registered public key? If not: `invalid_signature`.
   - Is it newer than the last message from this device (boot ID + sequence)? If not: `replayed_message`.
   - Is the message well-formed? If not: `malformed_message`.
5. **It enters Kafka.** Valid messages go to `telemetry.verified`, everything else to `telemetry.rejected` along with the reason.
6. **The backend scores it.** It computes 11 physics-based features and runs the XGBoost model, which returns probabilities for four classes: normal, inflate, flatline, degrade.
7. **It's stored and broadcast.** The reading (with the exact signed message) goes into the database and is pushed over WebSocket to every open dashboard. The chart updates, and suspicious points turn red.

A rejected message never reaches the AI. It's stored, and it raises a "forged device blocked" security alert (at most one every 30 seconds per asset).

---

## 5. The journey of one hour: batch, AI verdict, chain, payout

Every simulated hour (12 real seconds at the default speed) the backend closes a **batch** for each asset:

1. **Collect** the hour's 12 readings (one per 5 simulated minutes).
2. **Hash.** Compute a SHA-256 hash over the exact signed messages. Anyone can recompute this later from the raw data; that's what the **Verify** button does. The check runs **in the viewer's own browser**: the browser downloads the raw signed readings, hashes them itself, and reads the recorded hash directly from the chain, so the platform server's answer is not used. If the browser can't do this (no Web Crypto, chain unreachable), the dialog falls back to the server-side check and says so.
3. **Judge.**
   - A reading is *suspicious* if its fraud probability (inflate + flatline) is above 50%.
   - A batch is **flagged** if **3 or more of its 12 readings** are suspicious.
   - The *anomaly score* is the average of the three highest fraud probabilities.
   - If the batch isn't flagged but 3+ readings look like degradation, the verdict is "degrade".
   - For any non-normal verdict, the explanation comes from SHAP values: the top reasons for the decision.
4. **Alerts.** A flagged batch creates a fraud alert. A degrade verdict creates a maintenance alert, closed automatically after 3 healthy hours in a row.
5. **Anchor on-chain.** Call `EnergyOracle.recordBatch(asset, period, energy in Wh, hash, anomaly score, flagged)`.
6. **Settle.** Call `RevenueDistributor.settle(batch)`. The contract pulls `energy × $0.05/kWh` in USDC from the grid buyer.
   - **Not flagged:** the money is distributed to all shareholders through the accumulator.
   - **Flagged:** the money is held in on-chain escrow.
7. **Pay out.** Call `RevenueDistributor.payout(asset, holders)`, which pushes each platform user's claimable USDC into their wallet. The dashboard shows a "+$ revenue" toast.
8. **Forecast.** The LSTM forecast for that asset is refreshed with the new hour of data.

So each asset produces **three transactions per hour** (record, settle, payout), regardless of how many investors it has.

---

## 6. Layer by layer

### 6.1 Physical layer: sensor simulator (`iot/`)

**Six assets.** The names are fictional; the locations and sizes are realistic.

| Token | Asset | Type | Region | Capacity |
|---|---|---|---|---|
| 1 | Gobustan Solar Park | Solar | Gobustan | 60 MW |
| 2 | Bilasuvar Sun Fields | Solar | Bilasuvar | 120 MW |
| 3 | Sharur Highland Solar | Solar | Nakhchivan | 30 MW |
| 4 | Sumgait Rooftop Cluster | Solar | Sumgait | 5 MW |
| 5 | Khizi Ridge Wind Farm | Wind | Khizi | 240 MW (40 turbines) |
| 6 | Absheron Coastal Wind | Wind | Absheron | 80 MW (16 turbines) |

**Solar physics:**
- The sun's elevation is computed from latitude, longitude and time (NOAA formula).
- Clear-sky irradiance = 1000 W/m² × sin(elevation)^1.15.
- Clouds follow a random process: occasional cloud banks that clear gradually. They reduce irradiance by up to 75%.
- Panel temperature rises with sunlight, and efficiency drops 0.4% per °C above 25 °C. There are also 3% system losses.
- Result: a realistic ~16–18% capacity factor in September.

**Wind physics:**
- Wind speed is mean-reverting (Khizi averages 9.2 m/s, Absheron 9.6 m/s), with an afternoon sea breeze and gusts.
- The turbine power curve: nothing below 3 m/s (cut-in), a cubic rise to full power at 12.5 m/s (rated), and shutdown above 25 m/s (cut-out). 97% of turbines are available.
- Result: a ~33–38% capacity factor.

**Time.** The simulated clock starts at 05:00 Baku time (a sunrise) and runs at 300× by default: 1 real second = 5 simulated minutes, so a full day passes in about 5 minutes. The presenter panel can switch between 1× (live), 300× and 1200×.

**Faults the presenter can inject** (`Ctrl+Shift+D`):

| Fault | What the meter does | Platform response |
|---|---|---|
| **Inflate** (meter fraud) | Reports 1.7× the real output + 12% of capacity; still produces "output" at night | AI flags it → revenue goes to escrow → multisig decides |
| **Flatline** (frozen meter) | Keeps sending the same value | AI flags it → escrow |
| **Degrade** (wear) | Real output slides toward 50% over ~1.5 simulated days | Revenue is paid normally; producer gets a maintenance alert |
| **Forge** (fake device) | An attacker sends extra messages claiming 95% of capacity, signed with an unknown key | Rejected at the bridge → security alert; the AI never sees them |

> Demo tip: always demo tampering on **Khizi (wind)**. Wind plants produce at night too; a frozen solar meter at night reads zero, which is indistinguishable from normal.

### 6.2 Data layer: MQTT, bridge, Kafka

- **MQTT (Mosquitto)** is the lightweight IoT protocol, as in the report.
- **The bridge** is our stand-in for AWS IoT Core: it authenticates every device message (section 4). **Device keys:** each device's private key stays with the device (`iot/.keys/`, never in git); only public keys are in `iot/device_registry.json`.
- **Kafka (Redpanda)** carries two topics, `telemetry.verified` and `telemetry.rejected`. The Kafka console at `localhost:8080` lets the jury see the live stream.

### 6.3 Intelligence layer (`backend/app/ai/`, `backend/app/esg.py`)

#### XGBoost anomaly detector

**What it does:** classifies every reading as normal, inflate (meter fraud), flatline (frozen signal) or degrade (wear).

**The key idea, physics-informed features.** A meter's reported power must be consistent with what the device's own environmental sensors and the sun's position physically allow. The 11 features:

| Feature | Meaning |
|---|---|
| power_ratio | Reported power / capacity |
| implied_ratio | Power the measured irradiance or wind speed physically allows |
| residual | Reported minus physically allowed |
| consistency | Reported ÷ physically allowed (the strongest fraud signal) |
| sun_elevation | Computed by the server from time and location, so the device can't fake it |
| night_output | Solar output reported while the sun is below the horizon |
| is_solar | Asset type |
| env_level | Irradiance or wind level |
| rolling_std | Variability of the last 6 readings (a frozen meter gives 0) |
| unchanged_count | Identical readings in a row |
| delta_prev | Change since the previous reading |

**Training data.** We ran the *same* simulator offline for **90 days × 6 assets = 155,520 readings**, with random fault episodes (inflate 2–12 h, flatline 1–8 h, degrade 1–3 days). The seeds differ from the live demo's.

Labels are honest: a reading is labeled a fault only if the fault actually changed it. For example, a frozen solar meter at night that reads the same zero as reality is labeled normal.

**Training.** XGBoost with 300 trees, depth 6. **Time-based split:** the first 80% of days train the model, the last 20% (31,104 readings it has never seen) test it.

**Results on unseen data:**

| Class | Precision | Recall |
|---|---|---|
| Normal | 99.8% | 99.7% |
| Inflate | 100% | 100% |
| Flatline | 95.2% | 98.7% |
| Degrade | 99.5% | 99.1% |
| **Overall accuracy** | **99.6%** | |

**Explainability.** For every flagged batch, XGBoost's built-in SHAP values give the top reasons. Example from our tests: "Output vs. sensor-implied output: 2.7× (strongest contribution)".

**Honesty point.** The numbers are high because the data is simulated and the physics relationship is clean. Real-world data is noisier; retraining on pilot data is step one of the roadmap.

#### LSTM production forecaster

**What it does:** predicts the next 24 hours of output from the last 48 hours.

**Model:** a 2-layer LSTM (64 units) reads the 48-hour history (output, time of day, and a context value). A small network head then combines the LSTM's summary with **known future context**: for solar, the clear-sky potential of each coming hour; for wind, a daily wind pattern. There is one model per technology.

**The solar physics prior.** Our first version was **11% worse** than the naive guess "tomorrow = today". We fixed it by making the solar output equal the *clear-sky potential × a learned clearness factor (0–1)*. Nights are then exactly zero, and the network only has to learn the weather.

**Results (mean error as a share of capacity):**

| | LSTM | Naive (tomorrow = today) | Improvement |
|---|---|---|---|
| Solar | 2.78% | 3.76% | **26% better** |
| Wind | 13.38% | 18.65% | **28% better** |

**Where it's used:** forecast charts, the producer dashboard (next 24 h of production), and the ESG report.

**Cold start.** When the demo begins, 48 hours of "history" are generated with the physics model, so charts and forecasts work from the first minute. These hours are marked `backfilled` in the database.

#### ESG engine: transparent scoring

The score runs from 0 to 100. **Weights: Environmental 40%, Social 20%, Governance 40%.**

| Pillar | Formula | Source |
|---|---|---|
| **E** | 50 (zero-emission generation) + 50 × min(1, 24h capacity factor ÷ benchmark) | Live data. Benchmarks: solar 17%, wind 35% |
| **S** | 40 + 30 × local-hiring % + 30 × min(1, jobs per MW) | Producer's declaration (stated openly) |
| **G** | 40 × data integrity + 40 × max(0, 1 − 3 × anomaly rate) + 20 × controls | Live. Integrity = verified ÷ (verified + rejected) messages; anomaly rate = flagged batches ÷ all batches; controls = signatures, on-chain anchoring, multisig, KYC |

**Ratings:** A+ ≥ 90, A ≥ 80, B ≥ 70, C ≥ 55, otherwise D.

**Other outputs:**
- **CO₂ avoided** = kWh × 0.44 kg (Azerbaijan's gas-fired grid average, an assumption we state).
- **Households powered** = annual kWh ÷ 2,200 kWh (an average household).

Because G reacts to live data, a tampering demo visibly lowers the asset's ESG score.

#### AI risk engine: live risk level per asset (`backend/app/risk.py`)

Every asset gets a **risk score from 0 to 100** and a level: **Low** (<20), **Medium** (20–44) or **High** (≥45). It is recalculated from live data and shown on the asset page and in the printable ESG & risk report, with plain-language reasons.

| Signal | Model | Points | Rule |
|---|---|---|---|
| **Fraud signal** | XGBoost | up to 45 | 45 while flagged revenue is held (not yet decided by the multisig); 25 if flagged hours in the last 24 h were resolved |
| **Performance vs forecast** | LSTM (+ XGBoost wear) | up to 35 | Reported energy over the last 24 h vs. the LSTM's one-hour-ahead forecast for those same hours. Outside the normal band: 20; far outside: 35. An open maintenance alert gives at least 20 |
| **Data trust** | Ed25519 | up to 20 | 10 if any forged-device message was blocked in the last 24 h; 20 if 12 or more |

**How the LSTM is used.** Each hour the app stores the forecast for the next hour (`forecast_log` table). Once 24 compared hours exist (about 5 minutes after start at 300×), it compares them with what was actually reported. Until then the panel shows "Building the forecast comparison: n/24 hours". On very calm days (a 24 h forecast below 0.2 full-load hours) the comparison is skipped as unfair.

**Where the thresholds come from.** `backend/scripts/calibrate_risk.py` runs the same simulator offline for 40 normal days with unseen seeds, plus degradation and meter-inflation scenarios, and measures the 24 h forecast gap:

| | Normal (1st–99th percentile) | Worn equipment | Inflated meter |
|---|---|---|---|
| Solar | −18% … +12% | −44% … −58% | +111% or more |
| Wind | −26% … +22% | −27% … −68% | +32% or more |

So the normal band is **±20% for solar** and **±30% for wind**, and "far outside" is ±35% / ±45%. In a live test, healthy plants stayed Low for 4 simulated days. Fraud took Khizi to High within 40 s, wear and forging took assets to Medium, and everything returned to Low after the faults were cleared and the multisig resolved the escrow.

### 6.4 Blockchain layer: the 8 smart contracts (`contracts/`)

Solidity 0.8.24, built on the audited OpenZeppelin 5 libraries, with Hardhat for testing.

| Contract | Role | Key rules |
|---|---|---|
| **MockUSDC** | Test stablecoin | 6 decimals like real USDC; the platform can mint (fiat on-ramp) |
| **KYCRegistry** | Verified-wallet list | Only the verifier role (the platform) can approve or revoke |
| **AssetToken** (ERC-1155) | One token ID per asset; one unit = one share | Transfers only between KYC-verified wallets; can be paused; reports every balance change to the RevenueDistributor |
| **EnergyOracle** | Hourly production records | Stores asset, period, energy (Wh), data hash, anomaly score, flagged; rejects overlapping periods; only the platform's oracle role can write |
| **RevenueDistributor** | Turns energy into payouts | Pulls kWh × tariff from the grid buyer; distributes via the accumulator or escrows flagged batches; release or refund needs the multisig |
| **PrimaryMarket** | New shares from the producer | $10/share, $50 minimum, 1% fee from the producer's proceeds; cannot sell beyond the offered 20% |
| **Marketplace** | Investor-to-investor trading | Non-custodial listings; partial fills; 1% fee from the seller |
| **MultiSig** | 2-of-3 governance | Propose → approve; auto-executes at the second approval; one approval per signer |

**Important mechanisms:**

**1. The revenue accumulator (why payouts scale).** Instead of looping over every holder (cost grows with investors), the contract keeps one number per asset: *revenue per share so far* (scaled by 2^128 for precision). Each settlement adds `amount ÷ total shares` to it, a constant cost whatever the number of investors.

A holder's earnings = their shares × that number, adjusted by a per-holder *correction*. The correction is updated on every transfer, so past revenue stays with the seller and new revenue follows the shares. The tests prove this exact behavior.

**2. All shares start with the producer.** When an asset is tokenized, 100% of the shares are minted to the producer. The PrimaryMarket sells the offered 20% *using the producer's approval*.

Why: if the sale contract held unsold shares, the revenue on them would get stuck in the contract. This way unsold shares keep earning for the producer.

**3. Non-custodial listings.** Listed shares stay in the seller's wallet until someone buys them, so sellers keep earning while waiting.

**4. KYC on every transfer.** Both sender and receiver must be verified. The sale contracts are *operators* (they move shares between verified wallets), not holders, so they don't need KYC themselves.

**5. Role handover.** After deployment, every admin power moves to the 2-of-3 multisig, and the deployer renounces all its roles; the smoke test verifies this. Admin powers cover escrow release and refund, pausing, fee changes and creating assets.

The platform keeps only operational roles: oracle (writing batches), keeper (settle and payout), KYC verifier, and USDC minter (on-ramp).

**6. Fee bounds are enforced by code.** The fee can only be set between 0.5% and 1.5% (the report's range), and only by the multisig.

**Local accounts (dev mnemonic):**

| Index | Role |
|---|---|
| 0 | Deployer (renounces everything) |
| 1 | Platform: oracle, keeper, KYC verifier, minter |
| 2 | Grid buyer (off-taker), pays for energy |
| 3–5 | Multisig signers: Leyla (Risk), Murat (Compliance), Elvin (CTO) |
| 6 | Solar producer (Caspian Solar Holdings) |
| 7 | Wind producer (Absheron Wind Energy) |
| 8 | Treasury, collects fees |

**Chain:** a local EVM chain (Anvil, chain ID 31337) with **instant mining**: every transaction confirms immediately. It's Polygon-compatible; the same contracts deploy to Polygon Amoy with `contracts/scripts/deploy-public.js`.

### 6.5 Financial layer

**Escrow decisions (governance page):**
- **False alarm:** "release" → the escrowed USDC is distributed to shareholders and paid out.
- **Confirmed fraud:** "refund" → the USDC goes back to the grid buyer, who paid for energy that never existed.
- Either decision needs 2 of the 3 signers. On stage: Leyla proposes, then you switch to Elvin, who approves, and the contract executes.

**Automatic payouts.** After each distributed batch, the keeper pushes claimable revenue into every platform user's wallet. Nobody presses "claim". Holders can still call `claim()` themselves.

**Open Banking (PSD2 sandbox):**
1. Choose a bank (4 fictional banks: 2 Azerbaijani, 2 Turkish) and an amount.
2. **Consent screen:** the scopes requested ("view account", "initiate payment"), the IBAN, the amount, a 5-minute, single-use validity, and "PSD2 · Strong Customer Authentication".
3. **Bank approval screen:** SMS code (sandbox code **123456**; a wrong code is refused).
4. **Settlement:**
   - **Deposit:** the platform mints the same amount of test USDC into the wallet (1:1 fiat on-ramp).
   - **Withdraw:** USDC moves from the wallet to the platform's off-ramp account (standing in for the fiat payout).

### 6.6 User layer: the web app (`frontend/`)

Next.js 16 and TypeScript, with Tailwind, Recharts and Motion. It uses a dark "energy-tech" theme, **Turkish by default with an English toggle**, and **USD / AZN / TRY display** at fixed demo rates (1 USD = 1.70 AZN = 41 TRY; settlement is always USDC). Everything is bundled locally, including the fonts and the map, so it works fully offline.

| Page | Who | What it shows |
|---|---|---|
| **Home** `/` | Everyone | Live stats (MW now, revenue distributed, verified MWh, CO₂, investors, escrow), Azerbaijan map with glowing assets, live event feed, problem → solution, how it works |
| **Assets** `/assets` | Everyone | 6 offerings: yield, price, live output, % funded, investors, ESG |
| **Asset detail** | Everyone | Live chart (red dots = AI suspicion), LSTM forecast vs actual, on-chain batch table with **Verify** (checked in the browser), ESG breakdown, **AI risk assessment** (Low/Medium/High with reasons), invest box, AI audit feed, escrow banner with "why flagged" |
| **Market** `/market` | Investors | Price tickers vs NAV, order book, buy dialog, sell form, live trade tape |
| **Portfolio** | Investors | Ticking earnings, earning rate, projected annual income, holdings, activity with tx links, Open Banking deposit/withdraw |
| **Producer panel** | Producers | Financing raised, investors, performance ratio, 24h vs forecast, maintenance alerts with a suggested action, SaaS plans |
| **ESG & risk report** | Producers, institutional investors, signers | Printable A4 report with the live AI risk score, "Download as PDF" |
| **Governance** | Signers | Escrowed batches with evidence, propose release/refund, second signature, proposal history |
| **Business model** `/economics` | Everyone | Live treasury, the 4 revenue streams, market opportunity figures |
| **Live architecture** | Everyone | Figure 1 animated by real events; click a layer for its tech and live counters |
| **AI Lab** | Everyone | Accuracy, precision/recall, confusion matrix, feature importance, LSTM vs baseline, decision policy |
| **Explorer** | Everyone | Recent transactions, decoded transaction pages, contract addresses (plus Amoy links if deployed) |
| **Login** | Everyone | One-click personas, signup, animated KYC checks |

**Live updates.** One WebSocket connection carries every event: readings, batches, payouts, alerts, trades, investments, banking and multisig. Pages refresh their data when a relevant event arrives.

**Presenter scenario panel (`Ctrl+Shift+D`):** inject faults per asset, change the simulation speed, clear all faults, and switch persona instantly.

---

## 7. Economics and numbers

| Parameter | Value | Why |
|---|---|---|
| Share price | $10 | Readable share counts; the $50 minimum = 5 shares |
| Minimum investment | $50 | From the report; enforced in the contract |
| Share offered to investors | 20% of each asset | Realistic minority financing; the producer keeps 80% |
| Platform fee | 1% (bounds 0.5–1.5%) | From the report; paid by the seller (by the producer on primary sales) |
| Energy tariff (PPA) | $0.05 per kWh | Realistic for Azerbaijan |
| Asset valuation | Solar $0.8M/MW, wind $1.3M/MW | Typical build cost (capex) |
| Revenue cycle | Every simulated hour | Payouts visible on stage every ~12 seconds |

**Asset values:**

| Asset | Value | Total shares | Offered (20%) |
|---|---|---|---|
| Gobustan Solar | $48M | 4.8M | 960,000 |
| Bilasuvar Solar | $96M | 9.6M | 1.92M |
| Sharur Solar | $24M | 2.4M | 480,000 |
| Sumgait Rooftop | $4M | 400,000 | 80,000 |
| Khizi Wind | $312M | 31.2M | 6.24M |
| Absheron Wind | $104M | 10.4M | 2.08M |

**Expected yield (gross, before operating costs):**
- Solar: 17% capacity factor × 8,760 h × $0.05 ÷ $0.8M per MW ≈ **9.3% per year**.
- Wind: 35% × 8,760 × $0.05 ÷ $1.3M per MW ≈ **11.8% per year**.

**Why a $50 investment earns so little per hour.** $50 in Gobustan Solar earns about $0.0009 per hour at midday. That's the honest math of a ~9% yield. The UI handles it three ways:
- It shows **annualized projections** as headline numbers.
- It **animates earnings as they arrive**.
- **Aylin starts with an $8,000 portfolio**, so her payouts are visible (about $844 per year projected).

**Business model (4 revenue streams):**
1. **Transaction fee.** Live, read from the on-chain treasury. It looks large (about $600k) because the seeded anchor funds paid the 1% fee on about $60M of purchases. That's honest arithmetic; be ready to explain it.
2. **SaaS subscriptions (demo contracts).** Basic free; Pro $490 per month (the solar producer, and the Evergreen Climate Fund for ESG & risk reports); Enterprise $1,900 per month (the wind producer). Total $2,880 per month.
3. **Licensing (pipeline).** Regional utility pilot $36k/year, green bond issuer $60k/year.
4. **Carbon credits (future phase).** Portfolio CO₂ × $12 per tonne × a 5% platform share.

> The SaaS prices, the licensing pipeline and the carbon inputs are **our assumptions**. Adjust them in `backend/app/api/producer.py` to match your pitch.

---

## 8. Users, wallets and accounts

**Custodial wallets.** Every user gets a real blockchain wallet, created by the platform, which signs transactions on the user's behalf.
- The private key is encrypted with Fernet (AES) and stored in the database.
- A new wallet receives 1 test ETH for transaction fees.

Why custodial: no MetaMask pop-ups on stage, and the right experience for non-crypto retail investors. The production plan is HSM/MPC key management plus optional self-custody.

**Personas (one-click login):**

| Persona | Role | Notes |
|---|---|---|
| Aylin Kaya | Investor | KYC done; $10,000 deposited, $8,000 invested (Gobustan 300, Khizi 250, Absheron 150, Sumgait 100 shares) |
| Evergreen Climate Fund | Institutional investor | KYC done; $2M deposited, $1.6M invested (Khizi 60,000, Bilasuvar 50,000, Gobustan 30,000, Absheron 20,000 shares); Pro subscription, so its Portfolio page links to the ESG & risk report of every holding |
| Caspian Solar Holdings | Producer | Owns the 4 solar assets; Pro plan |
| Absheron Wind Energy | Producer | Owns the 2 wind assets; Enterprise plan |
| Leyla Hasanova | Signer | Chief Risk Officer |
| Murat Demir | Signer | Compliance Officer |
| Elvin Aliyev | Signer | CTO |

**Signup.** A real account is created: the password is hashed (PBKDF2, 200,000 rounds) and a new wallet is generated. Before KYC, investing is blocked. After the KYC form, the wallet is approved on-chain; then the user deposits and invests.

**The database resets with the chain.** Every `start.ps1` / `reset.ps1` creates a fresh chain. The backend notices the new deployment (by its timestamp) and rebuilds the database, so stale wallets and balances never mix with a new chain.

---

## 9. Demo data: what is generated and why

| Generated | How | Why |
|---|---|---|
| **200 retail investors** | Real wallets, KYC'd on-chain; budgets random around ~$400 (min $50, max $20k); each buys 1–2 assets | Offerings show investor counts and a realistic market |
| **5 institutional anchor funds** | Fictional names (Green Horizon Fund, Caspian Impact Capital, Anatolia ESG Partners, Silkway Climate Fund, Nexa Sustainable Income), each in 3 assets | Offerings reach 21–65% funded; the report names small funds as a target segment. Without them every raise showed under 3% and looked like a failure |
| **Live trickle** | A new small investment about every 25 s | The platform feels alive ("Farid C. bought 27 shares…") |
| **Market makers** | Background holders keep 8–14 listings open at 96–108% of NAV; sometimes a background buyer fills one | The order book and trade tape are never empty |
| **48 h of backfilled history** | Physics model, before the demo starts | Charts and the LSTM work from minute one |

**Background investors' revenue** accrues on-chain (claimable). To keep transactions light, the keeper only pushes payouts to interactive users (personas and people who sign up).

**If asked: "Are these real investors?"** No. They're demo participants with real on-chain wallets and transactions, but fictional people.

---

## 10. Infrastructure and how it runs

| Service | Port | Technology |
|---|---|---|
| Web app | 3000 | Next.js (production build by default) |
| API | 8100 | FastAPI + Uvicorn (8100 because another project on the dev laptop uses 8000) |
| Kafka console | 8080 | Redpanda Console |
| Blockchain RPC | 8545 | Anvil (Foundry) |
| MQTT | 1883 | Mosquitto |
| Kafka | 19092 | Redpanda |

**Startup (`start.ps1` on Windows, `start.sh` on macOS/Linux):**
1. Check prerequisites (Docker running, Node.js, Python 3.10+).
2. Start Docker services, and **recreate the chain** so the state is always clean.
3. Deploy the contracts. The addresses are always the same on a fresh chain.
4. Install Python packages and train the AI models if they're missing (they're committed, so normally skipped).
5. Start the backend, the simulator and the bridge.
6. Build the frontend only if its code changed, then start it.

**Scripts:** `stop.ps1` / `stop.sh` shut everything down; `reset.ps1` = stop + start for a clean demo.

**Storage.** SQLite (a single file, `backend/data/eco.db`). It holds users, sessions, readings (with the raw signed messages), rejections, batches, alerts, activity, trades and hourly energy.

**Why production mode matters.** In development mode, each page compiles the first time it's opened (up to 30 seconds). The production build loads every page in 50–300 ms. **Always use `start.ps1` without `-Dev` for the demo.**

---

## 11. Testing and quality evidence

| Test | What it proves | Result |
|---|---|---|
| **22 contract tests** (`npx hardhat test`) | KYC gate, pause, $50 minimum, 20% cap, fee bounds, pro-rata payouts, revenue follows shares, no double settlement, no overlapping periods, oracle access control, escrow, 2-of-3 release and refund, no single-key control, no double approval, marketplace fees, listed shares keep earning, cancel rules | All pass |
| **End-to-end test** (`backend/scripts/e2e.py`) | The whole platform live: invest, $40 rejected, auto-payout, fraud → flagged → escrow → hash verified → multisig release, forged device blocked, degradation alert, explorer decoding, signup → KYC → deposit → invest, marketplace trade, Open Banking deposit and withdraw (wrong OTP refused), producer report, economics | All pass |
| **Soak test** (`backend/scripts/soak.py 20`) | 20 minutes (~4 simulated days) with random faults: 7,288 readings, 612 batches, 17 flagged, 100 forgeries blocked | No crashes, stable memory, no real errors. Found 2 slow endpoints, fixed: listings 1.2 s → 6 ms, assets 300 ms → 24 ms |
| **Visual check** (`frontend/scripts/screenshots.py`) | Every page in a real browser, both languages | 0 console errors |
| **Security scan** (Slither, 102 detectors) | Known smart-contract vulnerability patterns | 0 vulnerabilities; 4 findings improved, 9 reviewed and explained in `docs/SECURITY_SCAN.md` |
| **Risk calibration** (`backend/scripts/calibrate_risk.py`) | Forecast-gap bands for the AI risk engine, from 40 simulated normal days vs. fault scenarios | Normal ±20% solar / ±30% wind |
| **Browser Verify** | The browser's hash equals the on-chain hash for every batch | 486 of 486 batches (normal, fraud, frozen, night, 300× and 1200×); a one-digit change is detected |
| **Type check + lint** | Code quality | 0 problems |

---

## 12. Decision log

The important choices we made, and why.

### Scope and format
| Decision | Chosen | Alternative rejected | Why |
|---|---|---|---|
| Demo format | Live on our laptop, fully offline | Hosted URL | No venue-network risk |
| Language | Turkish default + English toggle | One language | The jury is Turkish; English for international viewers |
| Honesty | Label everything real / local / simulated | Present everything as production | Judges respect honesty and punish fake screens |

### IoT
| Decision | Chosen | Why |
|---|---|---|
| Asset names | Fictional names, real Azerbaijani locations | Real names would imply partnerships that don't exist |
| Data source | Physics model + noise | Offline, deterministic, realistic; real datasets would need preprocessing time |
| Time | 1 s = 5 simulated min, switchable | A full day/night cycle in ~5 minutes on stage |
| Number of assets | 6 (4 solar, 2 wind) | A market that feels real, while each asset stays memorable |
| Device security | Ed25519 signature per device | Lets us demo both a forged device and a tampered real device |
| Faults | Inflate, flatline, degrade, forge | Covers fraud, broken meters, honest wear and attacks |
| Wind tuning | Mean speeds 9.2 / 9.6 m/s | The first version gave only ~20% capacity factor; Absheron is known for ~35% |

### Blockchain and economics
| Decision | Chosen | Alternative rejected | Why |
|---|---|---|---|
| Share price | $10, minimum 5 shares | $1 or $50 | Readable holdings; exact $50 minimum |
| Payout method | Accumulator + automatic keeper push | Loop over holders; claim-only | Scales (constant cost) *and* feels automatic |
| Anomaly enforcement | On-chain escrow | Backend simply withholds | Proves IoT + AI + blockchain are truly connected |
| Compliance | KYC whitelist on every transfer | Free transfers | The report rates regulatory risk as HIGH |
| Revenue source | Simulated grid buyer paying kWh × $0.05 | Fixed yield | Payouts follow real verified energy, as in real PPAs |
| Cycle | Every simulated hour | Every day; every reading | Visible on stage without flooding the chain |
| Multisig | Our own minimal 2-of-3 contract | Gnosis Safe; single key | Easy to explain and demo; matches the report |
| Offered share | 20% | 49% / 100% | Realistic green-financing structure |
| Fee scope | Primary and secondary, 1%, paid by seller | Secondary only | Investors pay exactly $10 per share |
| Escrow outcomes | Release (false alarm) or refund (fraud) | Release or burn | A refund makes economic sense: the buyer paid for fake energy |
| Shares at tokenization | All minted to the producer, sold by approval | Sale contract holds them | Unsold shares keep earning for the producer |
| Listings | Non-custodial | Escrowed in the contract | Sellers keep earning until sold |
| Mining | Instant | 2-second blocks | Instant confirmations, a snappier demo |
| Chain on start | Recreated fresh each time | Persistent | Identical, clean state for every demo |

### AI
| Decision | Chosen | Why |
|---|---|---|
| Training data | 90 simulated days with labeled faults | Real models with honest held-out metrics |
| Explainability | SHAP reasons per verdict | Not a black box: judges see *why* |
| Features | Physics-informed consistency checks | Generalize to real data; hard to fool |
| Fault policy | Fraud/frozen → escrow; wear → maintenance alert; forged → rejected | Doesn't punish investors for honest wear |
| LSTM | PyTorch, plus a clear-sky prior for solar | Matches the report; the prior turned −11% into +26% vs the baseline |
| ESG | Transparent E/S/G pillars | Every number is either live or openly declared |

### Platform and UX
| Decision | Chosen | Why |
|---|---|---|
| Wallets | Built-in custodial | No MetaMask pop-ups on stage; every action is still a real transaction |
| Login | Personas + real signup | Smooth demo, and judges can try it themselves |
| Database | SQLite | Zero setup, easy reset |
| Live updates | WebSocket | Instant, smooth live dashboard |
| Style | Dark energy-tech | Strong on a projector; matches the report's colors |
| Small numbers | Ticking earnings + annual projections + seeded portfolio + background market | Honest economics that still look alive |
| Map | Offline SVG | No internet needed |
| Presenter controls | Hidden panel (Ctrl+Shift+D) | Judges never see admin clutter |
| Currency | USD with AZN/TRY toggle | Friendly for Azerbaijani and Turkish judges |
| Open Banking | Full PSD2-style consent flow, fictional banks | Realistic without implying bank partnerships |
| Governance UI | Evidence chart + explanation + 2-step signing | Tells the complete story after tampering |
| Report | Browser print-to-PDF | Professional, offline, no extra dependencies |
| Frontend mode | Production build for the demo | Avoids 30-second first-load compile delays |
| Public chain | Amoy deploy kit; you run it with your own test wallet | Your key never leaves your machine; the demo stays offline-safe |

---

## 13. Known limitations and honest answers

| Limitation | What to say |
|---|---|
| AI trained on simulated data | "Methodologically sound, numbers optimistic. Step one of the pilot: retrain on real meter data." |
| Sensors are simulated | "Any device that signs MQTT messages plugs in unchanged. In production the bridge becomes AWS IoT Core with device certificates and TLS 1.3." |
| Local chain, not mainnet | "Same contracts; optional Amoy testnet deployment; mainnet after an independent audit." |
| Custodial keys stored encrypted locally | "Demo setup. Production: HSM/MPC key management, optional self-custody." |
| Contracts not audited | "22 tests, a Slither security scan with 0 vulnerabilities, OpenZeppelin libraries, multisig admin, pause switch. Independent audit before mainnet." |
| Not deployed on public Polygon | "The demo runs on a local copy of the chain so it works offline. The same contracts deploy to Polygon Amoy with `contracts/scripts/deploy-public.js`; the script checks the full gas cost first." |
| No regulatory approval | "Security-token risk rated HIGH in our report; KYC whitelist built in; pilot planned in the SPK (Türkiye) / Central Bank of Azerbaijan sandboxes." |
| Demo investors, funds and names are fictional | Say so directly if asked. |
| Social (S) score is self-declared | "Stated openly in the report; to be audited annually." |

Also see `docs/JURY_QA.md` for about 25 prepared questions and answers.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| **ERC-1155** | Token standard where one contract holds many token types; here, one token ID per asset |
| **Tokenization** | Representing ownership of a real asset as blockchain tokens |
| **KYC** | Know Your Customer: identity verification |
| **USDC** | A US-dollar stablecoin (1 USDC ≈ $1) |
| **PPA / off-taker** | Power Purchase Agreement / the grid buyer who pays for the energy |
| **Capacity factor** | Actual energy ÷ the maximum possible at full power all the time |
| **Performance ratio** | Actual capacity factor ÷ the expected benchmark |
| **NAV** | Net asset value; here, the $10 issue price per share |
| **Oracle** | A mechanism that brings real-world data on-chain (our EnergyOracle) |
| **Hash (SHA-256)** | A fingerprint of data; any change to the data changes the hash |
| **Ed25519** | A modern digital-signature algorithm; proves who sent a message |
| **Multisig (2-of-3)** | An action needs approval from 2 of 3 key holders |
| **Escrow** | Funds locked until a condition is met or a decision is made |
| **Keeper** | The platform service that triggers settlements and payouts |
| **Accumulator** | "Revenue per share so far"; makes payouts cost-constant |
| **SHAP** | A method that explains how much each feature contributed to an AI decision |
| **LSTM** | A neural network for time series (Long Short-Term Memory) |
| **XGBoost** | A gradient-boosted decision-tree algorithm |
| **MQTT** | Lightweight messaging protocol for IoT devices |
| **Kafka** | A high-throughput event streaming platform (we use Redpanda, which speaks the Kafka API) |
| **PSD2** | EU payment directive enabling Open Banking (regulated bank-account access with consent) |
| **Custodial wallet** | The platform holds the keys on the user's behalf |
| **Anvil** | A local Ethereum-compatible blockchain for development |
| **Polygon Amoy** | Polygon's public test network |
