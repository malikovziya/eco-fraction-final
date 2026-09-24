"""Train both AI models from generated simulation history and write their model cards.

Run:  python -m app.ai.train        (from the backend folder)
"""

import time

from iot.assets import ASSETS

from . import anomaly, forecast
from .dataset import generate


def main() -> None:
    t0 = time.time()
    print("Generating 90 days of simulated operation per asset...", flush=True)
    X, y, day_idx, hourly = generate(days=90)
    print(f"  {len(X):,} readings in {time.time() - t0:.0f}s", flush=True)

    print("Training XGBoost anomaly detector...", flush=True)
    card = anomaly.train(X, y, day_idx)
    print(f"  accuracy {card['accuracy']:.3f} on {card['test_rows']:,} held-out readings")
    for c, m in card["metrics"].items():
        print(f"  {c:9} precision {m['precision']:.3f}  recall {m['recall']:.3f}  n={int(m['support'])}")

    print("Training LSTM forecasters...", flush=True)
    fcard = forecast.train(ASSETS, hourly)
    for kind, m in fcard["kinds"].items():
        print(f"  {kind:5} MAE {m['mae_capacity_ratio']:.4f} of capacity "
              f"(persistence {m['persistence_mae']:.4f}, {m['improvement_vs_persistence']:.0%} better)")
    print(f"Done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
