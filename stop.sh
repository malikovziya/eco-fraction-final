#!/usr/bin/env bash
# Stops the Eco-Fraction stack started by start.sh.
ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS="$ROOT/logs/.pids"
if [ -f "$PIDS" ]; then
  while read -r pid; do
    # Kill the process and its children (npm spawns next, uvicorn --reload spawns a worker)
    pkill -TERM -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null
  done < "$PIDS"
  rm -f "$PIDS"
fi
# Anything left bound to our ports (e.g. started by hand)
for port in 3000 8100; do
  pids=$(lsof -ti tcp:$port -sTCP:LISTEN 2>/dev/null) && [ -n "$pids" ] && kill $pids 2>/dev/null
done
pkill -f "iot\.(simulator|bridge)" 2>/dev/null
docker compose -f "$ROOT/infra/docker-compose.yml" down
echo "Eco-Fraction stopped."
