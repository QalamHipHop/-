"""Train the risk model from a real, operator-supplied labelled dataset.

The previous version generated synthetic features and synthetic labels. That is not
acceptable for a financial risk gate. This script therefore refuses to train unless
DATASET_PATH points to a real CSV file containing the declared features and `label`.
"""
from __future__ import annotations

import csv
import json
import logging
import math
import os
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

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
MIN_TRAINING_ROWS = 1000


def load_real_dataset(path: str) -> tuple[np.ndarray, np.ndarray]:
    dataset = Path(path)
    if not dataset.is_file():
        raise FileNotFoundError(f"real risk dataset not found: {dataset}")
    if dataset.suffix.lower() != ".csv":
        raise ValueError("risk training dataset must be a CSV file")

    with dataset.open("r", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fields = set(reader.fieldnames or [])
        required = set(FEATURE_KEYS) | {"label"}
        missing = required - fields
        if missing:
            raise ValueError(f"risk dataset missing columns: {sorted(missing)}")

        rows: list[list[float]] = []
        labels: list[int] = []
        for line_number, row in enumerate(reader, start=2):
            try:
                values = [float(row[key]) for key in FEATURE_KEYS]
                label = int(row["label"])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"invalid risk dataset row {line_number}") from exc
            if not all(math.isfinite(value) for value in values):
                raise ValueError(f"non-finite feature at risk dataset row {line_number}")
            if label not in (0, 1):
                raise ValueError(f"label must be 0 or 1 at risk dataset row {line_number}")
            rows.append(values)
            labels.append(label)

    if len(rows) < MIN_TRAINING_ROWS:
        raise ValueError(f"risk dataset must contain at least {MIN_TRAINING_ROWS} labelled rows")
    if len(set(labels)) != 2:
        raise ValueError("risk dataset must contain both safe and risky labels")
    return np.asarray(rows, dtype=float), np.asarray(labels, dtype=int)


def train(dataset_path: str | None = None, out_dir: str = "models") -> dict:
    path = dataset_path or os.environ.get("RISK_DATASET_PATH")
    if not path:
        raise RuntimeError("RISK_DATASET_PATH is required; synthetic training is disabled")
    X, y = load_real_dataset(path)
    clf = LogisticRegression(max_iter=500, class_weight="balanced").fit(X, y)
    artifact = {
        "kind": "logreg",
        "features": list(FEATURE_KEYS),
        "training_rows": int(len(y)),
        "class_counts": {str(label): int((y == label).sum()) for label in (0, 1)},
        "dataset": str(Path(path).resolve()),
        "coef": clf.coef_[0].tolist(),
        "intercept": float(clf.intercept_[0]),
    }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "risk-v1.json").write_text(json.dumps(artifact, indent=2), encoding="utf-8")
    log.info("wrote %s from %s real labelled rows", out / "risk-v1.json", len(y))
    return artifact


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    train()
