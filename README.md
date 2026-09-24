# Eco-Fraction

Tokenized renewable energy investing — IoT + AI + Blockchain.
Team **VoltLedger** · Teknofest Finansal Teknolojiler Yarışması.

## Architecture

| Layer | Folder | Technology |
|---|---|---|
| Physical | `iot/` | Sensor simulator (solar / wind) |
| Data | `infra/` | MQTT (Mosquitto), Kafka (Redpanda) |
| Intelligence | `backend/` | FastAPI, XGBoost, LSTM, ESG engine |
| Blockchain | `contracts/` | Solidity, ERC-1155, local EVM chain |
| Financial | `contracts/`, `backend/` | USDC distribution, Open Banking (sandbox) |
| User | `frontend/` | Next.js investor & producer dashboards |

## Run

Requirements: Docker Desktop, Python 3.12, Node.js 20+.

```powershell
.\start.ps1   # starts everything
.\stop.ps1    # stops everything
```

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| API docs | http://localhost:8100/docs |
| Kafka console | http://localhost:8080 |
| Local chain RPC | http://localhost:8545 |

## IoT simulator

Six signed sensor streams (4 solar, 2 wind) flow `MQTT → bridge (Ed25519 check) → Kafka`.
Verified readings land in `telemetry.verified`, attacks in `telemetry.rejected`.

```powershell
.venv\Scripts\python -m iot.control fault gobustan-solar inflate on   # inflate | flatline | degrade | forge
.venv\Scripts\python -m iot.control clear                             # remove all faults
.venv\Scripts\python -m iot.control speed 1                           # live time (default 300 = 5 min/s)
.venv\Scripts\python -m iot.watch                                     # print the Kafka stream
```

## AI models

Trained on 90 simulated days per asset with labeled fault episodes (time-based 80/20 split).

```powershell
cd backend; ..\.venv\Scripts\python -m app.ai.train   # retrain both models (~2 min)
```

| Model | Task | Held-out result |
|---|---|---|
| XGBoost (4 classes) | normal / inflate / flatline / degrade per reading | 99.6% accuracy, SHAP explanations |
| LSTM + physics prior | next-24h production forecast | solar 26%, wind 28% better than persistence |

Model cards: `GET /api/ai/models`.

## Contracts & end-to-end checks

```powershell
cd contracts; npx hardhat test                    # 22 unit tests
.venv\Scripts\python backend\scripts\e2e.py        # full platform flow against the running stack
```

## Frontend (http://localhost:3000)

Turkish by default with an EN toggle; USD / AZN / TRY display toggle (fixed demo rates).

| Page | What it shows |
|---|---|
| `/` | Live platform stats, Azerbaijan asset map, live event feed, problem → solution |
| `/assets`, `/assets/[id]` | Offerings; live signed readings, LSTM forecast, on-chain batches with hash verification, ESG breakdown, invest |
| `/portfolio` | Holdings, auto-payout earnings, projected income, activity with tx links |
| `/architecture` | Report Figure 1, animated by real platform events |
| `/ai` | Model cards: accuracy, confusion matrix, feature importance, forecast vs. baseline |
| `/explorer`, `/tx/[hash]` | Recent transactions and decoded transaction details |
| `/login` | One-click personas, signup, sandbox KYC |

**Presenter scenario panel:** press `Ctrl+Shift+D` on any page to inject faults, change simulation speed or switch persona.

Screenshots of every page (needs `pip install playwright` + `playwright install chromium`):

```powershell
.venv\Scripts\python frontend\scripts\screenshots.py <out_dir>
```
