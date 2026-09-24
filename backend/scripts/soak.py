"""Stability soak: runs the live stack for N minutes with random fault injection, then reports
latency, memory, database growth and any errors in the service logs.

Run:  .venv\\Scripts\\python backend\\scripts\\soak.py 20
"""

import random
import statistics
import subprocess
import sys
import time
from pathlib import Path

import httpx

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2]
API = "http://127.0.0.1:8100/api"
ENDPOINTS = ["/assets", "/platform/stats", "/market/listings", "/batches?limit=20", "/assets/khizi-wind/forecast"]
ASSETS = ["gobustan-solar", "bilasuvar-solar", "khizi-wind", "absheron-wind", "sumgait-rooftop"]


def backend_memory_mb() -> float:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "(Get-NetTCPConnection -LocalPort 8100 -State Listen | Select-Object -First 1 | "
         "ForEach-Object { (Get-Process -Id $_.OwningProcess).WorkingSet64 })"],
        capture_output=True, text=True).stdout.strip()
    return int(out) / 2**20 if out.isdigit() else float("nan")


def main(minutes: float) -> None:
    http = httpx.Client(base_url=API, timeout=30)
    db = ROOT / "backend" / "data" / "eco.db"
    start_db, start_mem = db.stat().st_size, backend_memory_mb()
    start_stats = http.get("/platform/stats").json()
    latencies: dict[str, list[float]] = {e: [] for e in ENDPOINTS}
    failures = 0
    deadline = time.time() + minutes * 60
    rng = random.Random(1)
    while time.time() < deadline:
        for e in ENDPOINTS:
            t0 = time.perf_counter()
            try:
                http.get(e).raise_for_status()
                latencies[e].append((time.perf_counter() - t0) * 1000)
            except Exception:
                failures += 1
        if rng.random() < 0.15:  # random scenario, like a presenter clicking around
            asset, fault = rng.choice(ASSETS), rng.choice(["inflate", "flatline", "forge", "degrade"])
            http.post("/sim/fault", json={"asset_id": asset, "fault": fault, "on": True})
            time.sleep(20)
            http.post("/sim/fault", json={"asset_id": asset, "fault": fault, "on": False})
        time.sleep(5)

    end_stats = http.get("/platform/stats").json()
    print(f"Soak: {minutes:.0f} min · sim {http.get('/health').json()['sim'].get('sim_time')}")
    print(f"  readings +{end_stats['verified'] - start_stats['verified']:,} · batches +{end_stats['batches'] - start_stats['batches']} "
          f"· flagged +{end_stats['flagged'] - start_stats['flagged']} · rejected +{end_stats['rejected'] - start_stats['rejected']}")
    for e, xs in latencies.items():
        if xs:
            p95 = statistics.quantiles(xs, n=20)[-1] if len(xs) >= 20 else max(xs)
            print(f"  {e:32} median {statistics.median(xs):6.0f} ms · p95 {p95:6.0f} ms")
    print(f"  HTTP failures: {failures}")
    print(f"  backend memory: {start_mem:.0f} → {backend_memory_mb():.0f} MB")
    print(f"  database: {start_db / 2**20:.1f} → {db.stat().st_size / 2**20:.1f} MB")
    for log in ("backend.out.log", "backend.log", "simulator.err.log", "bridge.err.log"):
        lines = (ROOT / "logs" / log).read_text(encoding="utf-8", errors="replace").splitlines()
        bad = [l for l in lines if any(w in l for w in ("Traceback", "failed", "error", "Error", "skipped"))]
        print(f"  {log}: {len(bad)} error lines" + (f" · last: {bad[-1][:160]}" if bad else ""))


if __name__ == "__main__":
    main(float(sys.argv[1]) if len(sys.argv) > 1 else 20)
