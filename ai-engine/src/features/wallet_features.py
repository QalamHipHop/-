"""Heuristic feature extractors. Pure functions; deterministic.

These run before any model, so they're fast and cheap. The model then scores
the *feature vector*, not raw inputs — this keeps model size small and inputs
PII-safe.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

ZERO_ADDRESS_LIKE = {"0x0000000000000000000000000000000000000000", "0x0"}


def _safe_div(a: float, b: float) -> float:
    return a / b if b else 0.0


def wallet_features(address: str, history: list[dict[str, Any]]) -> dict[str, float]:
    """Extract a small fixed-size feature vector from a wallet's history."""
    n = len(history)
    if n == 0:
        return {
            "tx_count": 0,
            "unique_counterparties": 0,
            "first_seen_days": 0,
            "avg_tx_value": 0.0,
            "max_tx_value": 0.0,
            "failed_tx_ratio": 0.0,
            "is_zero_like": 1.0 if address.lower() in ZERO_ADDRESS_LIKE else 0.0,
            "dormant_ratio": 0.0,
            "fan_out": 0.0,
        }

    counterparties: set[str] = set()
    values: list[float] = []
    failed = 0
    timestamps: list[int] = []
    out_per_addr: Counter[str] = Counter()

    for tx in history:
        cp = tx.get("counterparty") or tx.get("to") or tx.get("from")
        if cp:
            counterparties.add(str(cp).lower())
        v = float(tx.get("value", 0) or 0)
        values.append(v)
        if tx.get("status") == "failed":
            failed += 1
        ts = tx.get("ts")
        if isinstance(ts, (int, float)):
            timestamps.append(int(ts))
        frm = (tx.get("from") or "").lower()
        if frm == address.lower():
            out_per_addr[str(cp or "").lower()] += 1

    avg_v = _safe_div(sum(values), len(values))
    max_v = max(values) if values else 0.0
    failed_ratio = _safe_div(failed, n)
    fan_out = _safe_div(len(out_per_addr), n)
    first_seen_days = 0
    dormant_ratio = 0.0
    if timestamps:
        ts_min, ts_max = min(timestamps), max(timestamps)
        # Integrations may provide Unix seconds or Unix milliseconds. Normalize
        # before deriving age; treating seconds as milliseconds silently made
        # every wallet appear brand new.
        span = max(ts_max - ts_min, 1)
        seconds_per_day = 86_400
        if max(abs(ts_min), abs(ts_max)) >= 10**11:
            seconds_per_day *= 1000
        first_seen_days = span / seconds_per_day
        # Longest gap > 30d = "dormant" period
        sorted_ts = sorted(timestamps)
        gaps = [b - a for a, b in zip(sorted_ts, sorted_ts[1:])]
        if gaps:
            dormant_ratio = _safe_div(sum(1 for g in gaps if g > 30 * 86_400_000), len(gaps))

    return {
        "tx_count": float(n),
        "unique_counterparties": float(len(counterparties)),
        "first_seen_days": first_seen_days,
        "avg_tx_value": avg_v,
        "max_tx_value": max_v,
        "failed_tx_ratio": failed_ratio,
        "is_zero_like": 1.0 if address.lower() in ZERO_ADDRESS_LIKE else 0.0,
        "dormant_ratio": dormant_ratio,
        "fan_out": fan_out,
    }


# Words that, in combination, correlate with rugpull language.
_RISK_TOKENS = {
    "guaranteed", "100x", "1000x", "moonshot", "pump", "rug", "scam",
    "trust me", "no dump", "lambo", "wagmi", "few", "last chance",
    "act now", "limited", "exclusive", "dm me", "giveaway",
    "airdrop", "free mint", "stealth", "founder",
}


def text_features(text: str) -> dict[str, float]:
    if not text:
        return {"risk_hits": 0.0, "caps_ratio": 0.0, "exclaim": 0.0, "emoji": 0.0, "length": 0.0}
    lower = text.lower()
    hits = sum(1 for tok in _RISK_TOKENS if tok in lower)
    letters = [c for c in text if c.isalpha()]
    caps = sum(1 for c in letters if c.isupper())
    caps_ratio = _safe_div(caps, len(letters))
    exclaim = text.count("!")
    emoji = len(re.findall(r"[\U0001F300-\U0001FAFF\U00002700-\U000027BF]", text))
    return {
        "risk_hits": float(hits),
        "caps_ratio": caps_ratio,
        "exclaim": float(exclaim),
        "emoji": float(emoji),
        "length": float(len(text)),
    }


def sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)
