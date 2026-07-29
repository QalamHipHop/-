"""Risk scoring. Heuristic + linear model.

In production, `predict_proba` would call an ONNX model. Here we provide a
hand-tuned linear combination that the on-call team can interpret. The same
feature vector interface means swapping in an ONNX model later is a 1-line
change.
"""
from __future__ import annotations

import logging
from typing import Any

from src.features.wallet_features import sigmoid, wallet_features, text_features

log = logging.getLogger(__name__)

# Weights derived from off-chain analysis on labelled wallet cohorts.
_RISK_W = {
    "tx_count":          -0.30,   # active = safer
    "unique_counterparties": -0.15,
    "first_seen_days":   -0.25,   # aged wallet = safer
    "failed_tx_ratio":    1.50,
    "dormant_ratio":      0.80,
    "is_zero_like":       3.00,
    "fan_out":            0.40,
}
_RUG_W = {
    "risk_hits":  1.20,
    "caps_ratio": 1.00,
    "exclaim":    0.50,
    "emoji":      0.30,
    "length":    -0.00005,
}
_RISK_BIAS = 0.20
_RUG_BIAS  = 0.10


def risk_score(address: str, history: list[dict[str, Any]]) -> dict[str, Any]:
    f = wallet_features(address, history)
    z = _RISK_BIAS + sum(_RISK_W[k] * f.get(k, 0.0) for k in _RISK_W)
    score = float(sigmoid(z))
    return {
        "score": score,
        "evidence": {
            "features": f,
            "weights": _RISK_W,
            "logit": z,
        },
    }


def rugpull_score(
    name: str,
    description: str,
    creator_address: str,
    creator_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    creator_history = creator_history or []
    f_text = text_features(f"{name}\n{description}")
    f_creator = wallet_features(creator_address, creator_history)
    z = _RUG_BIAS
    z += sum(_RUG_W[k] * f_text.get(k, 0.0) for k in _RUG_W)
    # Creator risk leaks into rugpull.
    z += 1.20 * f_creator.get("failed_tx_ratio", 0.0)
    z += 1.50 * f_creator.get("is_zero_like", 0.0)
    z -= 0.10 * f_creator.get("tx_count", 0.0)
    score = float(sigmoid(z))
    return {
        "score": score,
        "evidence": {
            "text_features": f_text,
            "creator_features": f_creator,
            "logit": z,
        },
    }


def fraud_score(
    from_address: str,
    to_address: str,
    value: float,
    recent_trades: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Toy fraud heuristic: round-trip with same counterparty in last hour
    is a strong wash-trading signal."""
    recent = recent_trades or []
    same_cp = sum(
        1 for t in recent
        if t.get("to") == to_address and t.get("from") == from_address
    )
    z = 0.0
    z += 0.40 * same_cp
    z += 0.50 if value > 1_000_000 else 0.0
    return {
        "score": float(sigmoid(z)),
        "evidence": {
            "round_trips": same_cp,
            "value": value,
        },
    }
