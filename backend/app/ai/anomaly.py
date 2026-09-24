"""XGBoost anomaly detector: classifies each reading as normal / inflate / flatline / degrade,
with per-verdict feature contributions (SHAP values) for explainability."""

import json

import numpy as np
import xgboost as xgb
from sklearn.metrics import classification_report, confusion_matrix

from ..config import MODELS_DIR
from .features import CLASSES, FEATURE_LABELS, FEATURES, FRAUD_CLASSES

MODEL_PATH = MODELS_DIR / "anomaly_xgb.json"
CARD_PATH = MODELS_DIR / "anomaly_card.json"


def train(X: np.ndarray, y: np.ndarray, day_idx: np.ndarray) -> dict:
    # Time-based split: train on the first 80% of days, evaluate on the unseen last 20%
    cutoff = np.quantile(day_idx, 0.8)
    train_mask = day_idx < cutoff
    model = xgb.XGBClassifier(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.9,
        colsample_bytree=0.9,
        objective="multi:softprob",
        num_class=len(CLASSES),
        tree_method="hist",
        eval_metric="mlogloss",
    )
    model.fit(X[train_mask], y[train_mask])
    model.get_booster().save_model(MODEL_PATH)

    pred = model.predict(X[~train_mask])
    report = classification_report(y[~train_mask], pred, labels=range(len(CLASSES)),
                                   target_names=CLASSES, output_dict=True, zero_division=0)
    importance = model.get_booster().get_score(importance_type="gain")
    card = {
        "model": "XGBoost multi-class classifier (300 trees, depth 6)",
        "classes": CLASSES,
        "features": FEATURES,
        "train_rows": int(train_mask.sum()),
        "test_rows": int((~train_mask).sum()),
        "split": "time-based: first 80% of simulated days for training, last 20% held out",
        "metrics": {c: {k: round(report[c][k], 4) for k in ("precision", "recall", "f1-score", "support")}
                    for c in CLASSES},
        "accuracy": round(report["accuracy"], 4),
        "confusion_matrix": confusion_matrix(y[~train_mask], pred, labels=range(len(CLASSES))).tolist(),
        "feature_importance": {FEATURES[int(k[1:])]: round(v, 2) for k, v in
                               sorted(importance.items(), key=lambda kv: -kv[1])},
    }
    CARD_PATH.write_text(json.dumps(card, indent=2))
    return card


class AnomalyDetector:
    def __init__(self):
        self.booster = xgb.Booster()
        self.booster.load_model(MODEL_PATH)
        self.card = json.loads(CARD_PATH.read_text())

    def predict(self, features: list[float]) -> dict:
        probs = self.booster.predict(xgb.DMatrix(np.array([features], dtype=np.float32)))[0]
        p = {c: float(probs[i]) for i, c in enumerate(CLASSES)}
        return {
            "probs": p,
            "fraud_prob": sum(p[c] for c in FRAUD_CLASSES),
            "degrade_prob": p["degrade"],
            "predicted": CLASSES[int(np.argmax(probs))],
        }

    def explain(self, rows: list[list[float]], cls: str, top: int = 3) -> list[dict]:
        """Average SHAP contributions towards `cls` over the given readings, strongest first."""
        contribs = self.booster.predict(xgb.DMatrix(np.array(rows, dtype=np.float32)), pred_contribs=True)
        k = CLASSES.index(cls)
        mean = contribs[:, k, :-1].mean(axis=0)  # drop the bias column
        values = np.array(rows).mean(axis=0)
        order = np.argsort(-mean)[:top]
        return [
            {
                "feature": FEATURES[i],
                "label": FEATURE_LABELS[FEATURES[i]],
                "value": round(float(values[i]), 3),
                "contribution": round(float(mean[i]), 3),
            }
            for i in order
            if mean[i] > 0
        ]
