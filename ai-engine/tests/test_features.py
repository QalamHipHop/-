"""Tests for ai-engine scoring and feature extraction."""
from __future__ import annotations

import pytest

from src.features.wallet_features import text_features, wallet_features
from src.scoring.moderator import image_moderation, text_moderation
from src.scoring.risk_scorer import fraud_score, risk_score, rugpull_score


def test_wallet_features_empty() -> None:
    f = wallet_features("0xabc", [])
    assert f["tx_count"] == 0
    assert f["unique_counterparties"] == 0
    assert f["is_zero_like"] == 0.0


def test_wallet_features_zero_address() -> None:
    f = wallet_features("0x0000000000000000000000000000000000000000", [])
    assert f["is_zero_like"] == 1.0


def test_wallet_features_active_wallet_has_low_risk() -> None:
    history = [
        {"from": "0xabc", "to": f"0x{i:x}", "value": 1.0, "status": "ok", "ts": 1_700_000_000 + i * 100}
        for i in range(50)
    ]
    sig = risk_score("0xabc", history)
    assert 0.0 <= sig["score"] <= 1.0
    assert sig["score"] < 0.5  # active aged wallet


def test_text_features_clean_text() -> None:
    f = text_features("A nice project with real value and good tokenomics")
    assert f["risk_hits"] == 0
    assert f["caps_ratio"] < 0.5


def test_text_features_scam_keywords() -> None:
    f = text_features("100x GUARANTEED, send me your ETH for the moonshot!!!")
    assert f["risk_hits"] >= 2
    # The signal contains uppercase emphasis, but not more uppercase than
    # lowercase letters; caps_ratio is defined per-letter.
    assert f["caps_ratio"] > 0.25


@pytest.mark.asyncio
async def test_image_moderation_without_model_is_unavailable() -> None:
    result = await image_moderation("https://example.invalid/image.png")
    assert result["status"] == "unavailable"
    assert result["score"] is None


def test_text_moderation_clean() -> None:
    r = text_moderation("Welcome to the project. We're building something useful.")
    assert r["score"] < 0.5


def test_text_moderation_hate() -> None:
    r = text_moderation("this is a kike scam project")
    assert r["score"] > 0.5
    assert r["evidence"]["hate_hits"] >= 1


def test_text_moderation_scam() -> None:
    r = text_moderation("send me your seed phrase for the airdrop")
    assert r["score"] > 0.5
    assert r["evidence"]["scam_hits"] >= 1


def test_rugpull_clean() -> None:
    sig = rugpull_score(
        name="FairToken",
        description="A utility token for our DeFi platform with audited contracts.",
        creator_address="0xrealcreator",
        creator_history=[
            {"from": "0xrealcreator", "to": "0xauditor", "value": 1, "status": "ok", "ts": 1_700_000_000}
        ] * 10,
    )
    assert sig["score"] < 0.5


def test_rugpull_obvious_scam() -> None:
    sig = rugpull_score(
        name="MOONLAMBO",
        description="1000x GUARANTEED!!! send me your ETH, dm me for early access",
        creator_address="0x0000000000000000000000000000000000000000",
        creator_history=[],
    )
    assert sig["score"] > 0.5


def test_fraud_score_clean() -> None:
    sig = fraud_score("0xa", "0xb", value=100)
    assert sig["score"] < 0.5


def test_fraud_score_wash_trade() -> None:
    history = [{"from": "0xa", "to": "0xb"} for _ in range(20)]
    sig = fraud_score("0xa", "0xb", value=10_000_000, recent_trades=history)
    assert sig["score"] > 0.5


@pytest.mark.parametrize("addr", ["0x0000000000000000000000000000000000000000", "0x0"])
def test_zero_like_addresses(addr: str) -> None:
    f = wallet_features(addr, [])
    assert f["is_zero_like"] == 1.0
