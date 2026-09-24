#!/usr/bin/env bash
# Starts the full Eco-Fraction stack on macOS / Linux (same steps as start.ps1 on Windows).
# Usage: ./start.sh          production frontend (use this for the demo)
#        ./start.sh --dev    hot-reloading frontend and backend
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
DEV=0; [ "${1:-}" = "--dev" ] && DEV=1
LOGS="$ROOT/logs"; mkdir -p "$LOGS"
COMPOSE="docker compose -f $ROOT/infra/docker-compose.yml"

# Prerequisites
missing=()
command -v docker >/dev/null || missing+=("Docker Desktop  https://www.docker.com/products/docker-desktop")
command -v docker >/dev/null && ! docker info >/dev/null 2>&1 && missing+=("Docker is installed but not running: start Docker Desktop")
command -v node >/dev/null || missing+=("Node.js 20 or newer  https://nodejs.org")
PY=""
for c in python3.12 python3 python; do
  if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then PY="$c"; break; fi
done
[ -n "$PY" ] || [ -d .venv ] || missing+=("Python 3.10+ (3.12 recommended)  https://www.python.org/downloads/")
if [ ${#missing[@]} -gt 0 ]; then
  echo "Cannot start, missing prerequisites:"; printf '  - %s\n' "${missing[@]}"; exit 1
fi
if curl -s -o /dev/null --max-time 2 http://127.0.0.1:8100/api/health; then
  echo "Eco-Fraction already appears to be running. Run ./stop.sh first."; exit 1
fi

echo "[1/4] Starting infrastructure (MQTT, Kafka, chain)..."
$COMPOSE up -d
$COMPOSE up -d --force-recreate chain  # fresh chain: every demo starts from the same clean state

echo "[2/4] Deploying smart contracts..."
[ -d contracts/node_modules ] || npm --prefix contracts install --no-fund --no-audit
(cd contracts && npx hardhat run scripts/deploy.js --network localhost > "$LOGS/deploy.log" 2>&1) \
  || { echo "Contract deployment failed, see logs/deploy.log"; exit 1; }
sed -n '2,9p' "$LOGS/deploy.log" | sed 's/^/   /'

echo "[3/4] Starting backend and IoT layer..."
[ -d .venv ] || "$PY" -m venv .venv
VPY="$ROOT/.venv/bin/python"; [ -x "$VPY" ] || VPY="$ROOT/.venv/Scripts/python.exe"
"$VPY" -m pip install -q --disable-pip-version-check -r backend/requirements.txt -r iot/requirements.txt
if [ ! -f backend/models/anomaly_xgb.json ]; then
  echo "   Training AI models (first run, ~2 minutes)..."; (cd backend && "$VPY" -m app.ai.train)
fi
RELOAD=(); [ $DEV = 1 ] && RELOAD=(--reload)
(cd backend && nohup "$VPY" -m uvicorn app.main:app --port 8100 ${RELOAD[@]+"${RELOAD[@]}"} \
  > "$LOGS/backend.out.log" 2> "$LOGS/backend.log" & echo $! >> "$LOGS/.pids")
for svc in simulator bridge; do
  nohup "$VPY" -m "iot.$svc" > "$LOGS/$svc.log" 2> "$LOGS/$svc.err.log" & echo $! >> "$LOGS/.pids"
  sleep 2  # simulator provisions device keys before the bridge loads the registry
done

echo "[4/4] Starting frontend..."
[ -d frontend/node_modules ] || npm --prefix frontend install --no-fund --no-audit
if [ $DEV = 1 ]; then
  CMD=dev
else
  CMD=start
  # Rebuild only when a frontend source is newer than the last production build
  if [ ! -f frontend/.next/BUILD_ID ] || [ -n "$(find frontend/src frontend/next.config.ts frontend/package.json -newer frontend/.next/BUILD_ID -type f | head -1)" ]; then
    echo "   Building production frontend (only after code changes, ~1 minute)..."
    (cd frontend && npx next build > "$LOGS/frontend-build.log" 2>&1) || { echo "Frontend build failed, see logs/frontend-build.log"; exit 1; }
  fi
fi
(cd frontend && nohup npm run "$CMD" > "$LOGS/frontend.log" 2> "$LOGS/frontend.err.log" & echo $! >> "$LOGS/.pids")

cat <<EOF

Eco-Fraction is starting:
  App             http://localhost:3000
  API docs        http://localhost:8100/docs
  Kafka console   http://localhost:8080
  Local chain     http://localhost:8545
Logs in $LOGS | Stop everything with ./stop.sh
EOF
