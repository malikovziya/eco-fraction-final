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
