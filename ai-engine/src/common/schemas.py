"""Pydantic schemas for the public AI API."""
from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field, condecimal


class RiskScoreRequest(BaseModel):
    address: str
    history: list[dict[str, Any]] = Field(default_factory=list)


class ScoreResponse(BaseModel):
    target: str
    kind: str
    score: float = Field(ge=0.0, le=1.0)
    flagged: bool
    evidence: dict[str, Any] = Field(default_factory=dict)


class RugpullRequest(BaseModel):
    symbol: str
    name: str
    description: str = ""
    creator_address: str
    creator_history: list[dict[str, Any]] = Field(default_factory=list)
    tokenomics: dict[str, Any] = Field(default_factory=dict)


class FraudRequest(BaseModel):
    tx_hash: str
    from_address: str
    to_address: str
    value: condecimal(gt=0)
    token: str
    chain: str = "rial"
    block_number: int


class TextModerationRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10_000)


class ImageModerationRequest(BaseModel):
    url: str | None = None
    base64: str | None = None
