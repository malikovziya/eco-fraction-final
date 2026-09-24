"""Paths and platform constants shared across the backend."""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"  # SQLite db + wallet encryption key (gitignored)
MODELS_DIR = BACKEND_DIR / "models"  # trained AI models + model cards
DEPLOYMENT_FILE = ROOT_DIR / "contracts" / "deployments" / "localhost.json"
ASSETS_FILE = ROOT_DIR / "shared" / "assets.json"

DATA_DIR.mkdir(exist_ok=True)
MODELS_DIR.mkdir(exist_ok=True)

# The IoT package (physics, topics) lives next to the backend
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

CHAIN_RPC = "http://127.0.0.1:8545"
CHAIN_ID = 31337
DEV_MNEMONIC = "test test test test test test test test test test test junk"  # local chain only

GRID_CO2_KG_PER_KWH = 0.44  # Azerbaijan grid average (gas-fired), used for CO₂-avoided
HOUSEHOLD_KWH_PER_YEAR = 2_200  # average Azerbaijani household consumption
FRAUD_THRESHOLD = 0.5  # per-reading fraud probability counted as suspicious
FLAG_MIN_SUSPICIOUS = 3  # suspicious readings in a batch (of 12) that trigger escrow
GAS_FUNDING_ETH = 1  # gas money for each new custodial wallet
