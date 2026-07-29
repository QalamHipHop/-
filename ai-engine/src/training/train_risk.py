"""Offline training stub. Real impl: load labelled cohorts from ClickHouse,
fit sklearn GBM, export to ONNX. Here we generate synthetic data, fit, and
dump a coefficient vector that the on-call team can inspect.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

from src.features.wallet_features import wallet_features

log = logging.getLogger(__name__)

FEATURE_KEYS = (
    "tx_count",
    "unique_counterparties",
    "first_seen_days",
    "failed_tx_ratio",
    "dormant_ratio",
    "is_zero_like",
    "fan_out",
)


def _synth(n: int = 1000, seed: int = 42) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    X = np.zeros((n, len(FEATURE_KEYS)))
    for i in range(n):
        X[i, 0] = rng.integers(0, 200)        # tx_count
        X[i, 1] = rng.integers(0, 100)        # unique_counterparties
        X[i, 2] = rng.uniform(0, 1000)        # first_seen_days
        X[i, 3] = rng.uniform(0, 0.2)         # failed_tx_ratio
        X[i, 4] = rng.uniform(0, 1)           # dormant_ratio
        X[i, 5] = rng.choice([0, 1], p=[0.99, 0.01])
        X[i, 6] = rng.uniform(0, 1)
    # Synthetic label: risky if failed ratio + dormant + is_zero_like high.
    logits = (
        2.0 * X[:, 3] + 1.5 * X[:, 4] + 3.0 * X[:, 5] - 0.02 * X[:, 0] - 0.001 * X[:, 2]
    )
    p = 1 / (1 + np.exp(-logits))
    y = (rng.uniform(0, 1, size=n) < p).astype(int)
    return X, y


def train(out_dir: str = "models") -> dict:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    X, y = _synth()
    clf = LogisticRegression(max_iter=200).fit(X, y)
    artifact = {
        "kind": "logreg",
        "features": list(FEATURE_KEYS),
        "coef": clf.coef_[0].tolist(),
        "intercept": float(clf.intercept_[0]),
    }
    (out / "risk-v1.json").write_text(json.dumps(artifact, indent=2))
    log.info("wrote %s", out / "risk-v1.json")
    return artifact


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    train()
