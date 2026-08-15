"""FastAPI surface. Exposes synchronous score endpoints + health."""
from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

from src.common.config import get_settings
from src.common.logging import setup_logging
from src.common.schemas import (
    FraudRequest,
    ImageModerationRequest,
    RiskScoreRequest,
    RugpullRequest,
    ScoreResponse,
    TextModerationRequest,
)
from src.scoring.moderator import image_moderation, text_moderation
from src.scoring.risk_scorer import fraud_score, risk_score, rugpull_score

log = logging.getLogger(__name__)

REQUEST_COUNT = Counter("ai_requests_total", "Total AI requests", ["endpoint", "kind"])
REQUEST_LATENCY = Histogram("ai_request_seconds", "AI request latency", ["endpoint"])
SIGNAL_COUNT = Counter("ai_signals_total", "Signals emitted", ["kind"])


class LaunchpadTokenRiskRequest(BaseModel):
    """Compatibility contract for the launchpad risk client."""

    name: str
    symbol: str
    description: str = ""
    website: str = ""
    telegram: str = ""
    twitter: str = ""
    logo_url: str = ""


class LaunchpadOrderRiskRequest(BaseModel):
    """Compatibility contract for launchpad order checks."""

    user_id: str
    market: str
    side: str
    amount_minor: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.ai_log_level)
    log.info("ai-engine starting on :%s", settings.ai_port)
    yield


app = FastAPI(
    title="Rial AI Engine",
    version="0.1.0",
    description="Fraud, risk, rugpull, and moderation scoring for the Rial platform.",
    lifespan=lifespan,
)


def _ok(target: str, kind: str, sig: dict, threshold: float) -> ScoreResponse:
    score = float(sig.get("score", 0.0))
    SIGNAL_COUNT.labels(kind=kind).inc()
    return ScoreResponse(
        target=target,
        kind=kind,
        score=score,
        flagged=score >= threshold,
        evidence=sig.get("evidence", {}),
    )


@app.post("/v1/risk/token")
async def score_launchpad_token(req: LaunchpadTokenRiskRequest) -> dict:
    """Score a launchpad token using the production launchpad HTTP contract."""
    t0 = time.perf_counter()
    creator_hint = req.website or req.twitter or req.telegram or req.symbol
    rug = rugpull_score(req.name, req.description, creator_hint)
    text = text_moderation(f"{req.name}\n{req.symbol}\n{req.description}")
    score = max(float(rug.get("score", 0.0)), float(text.get("score", 0.0)))
    REQUEST_COUNT.labels(endpoint="v1/risk/token", kind="token").inc()
    REQUEST_LATENCY.labels(endpoint="v1/risk/token").observe(time.perf_counter() - t0)
    return {
        "score": score,
        "components": {
            "rugpull": float(rug.get("score", 0.0)),
            "text_moderation": float(text.get("score", 0.0)),
        },
        "raw": {"rugpull": rug.get("evidence", {}), "text": text.get("evidence", {})},
    }


@app.get("/v1/risk/user/{user_id}")
async def score_launchpad_user(user_id: str) -> dict:
    """Return an explicit neutral score until verified user-history features are wired."""
    return {
        "score": 0.0,
        "components": {"history_unavailable": 1.0},
        "raw": {"user_id": user_id, "reason": "no on-chain or ledger history adapter configured"},
    }


@app.post("/v1/risk/order")
async def score_launchpad_order(req: LaunchpadOrderRiskRequest) -> dict:
    """Return a deterministic fraud signal for the launchpad order contract."""
    sig = fraud_score(req.user_id, req.market, float(max(req.amount_minor, 1)))
    return {
        "score": float(sig.get("score", 0.0)),
        "components": {"fraud": float(sig.get("score", 0.0))},
        "raw": sig.get("evidence", {}),
    }


@app.post("/score/risk", response_model=ScoreResponse)
async def score_risk(req: RiskScoreRequest) -> ScoreResponse:
    t0 = time.perf_counter()
    REQUEST_COUNT.labels(endpoint="risk", kind="wallet").inc()
    sig = risk_score(req.address, req.history)
    REQUEST_LATENCY.labels(endpoint="risk").observe(time.perf_counter() - t0)
    return _ok(req.address, "risk", sig, get_settings().risk_threshold)


@app.post("/score/rugpull", response_model=ScoreResponse)
async def score_rugpull(req: RugpullRequest) -> ScoreResponse:
    t0 = time.perf_counter()
    REQUEST_COUNT.labels(endpoint="rugpull", kind="token").inc()
    sig = rugpull_score(
        name=req.name,
        description=req.description,
        creator_address=req.creator_address,
        creator_history=req.creator_history,
    )
    REQUEST_LATENCY.labels(endpoint="rugpull").observe(time.perf_counter() - t0)
    return _ok(req.symbol, "rugpull", sig, get_settings().rugpull_threshold)


@app.post("/score/fraud", response_model=ScoreResponse)
async def score_fraud(req: FraudRequest) -> ScoreResponse:
    t0 = time.perf_counter()
    REQUEST_COUNT.labels(endpoint="fraud", kind="tx").inc()
    sig = fraud_score(
        from_address=req.from_address,
        to_address=req.to_address,
        value=float(req.value),
    )
    REQUEST_LATENCY.labels(endpoint="fraud").observe(time.perf_counter() - t0)
    target = f"{req.from_address}->{req.to_address}"
    return _ok(target, "fraud", sig, get_settings().fraud_threshold)


@app.post("/score/text", response_model=ScoreResponse)
async def score_text(req: TextModerationRequest) -> ScoreResponse:
    t0 = time.perf_counter()
    REQUEST_COUNT.labels(endpoint="text", kind="moderation").inc()
    sig = text_moderation(req.text)
    REQUEST_LATENCY.labels(endpoint="text").observe(time.perf_counter() - t0)
    flagged = sig["score"] >= 0.5
    return ScoreResponse(
        target="text",
        kind="text",
        score=sig["score"],
        flagged=bool(flagged),
        evidence=sig["evidence"],
    )


@app.post("/score/image", response_model=ScoreResponse)
async def score_image(req: ImageModerationRequest) -> ScoreResponse:
    t0 = time.perf_counter()
    REQUEST_COUNT.labels(endpoint="image", kind="moderation").inc()
    payload = req.base64 or req.url
    if not payload:
        raise HTTPException(status_code=400, detail="base64 or url required")
    sig = await image_moderation(payload)
    REQUEST_LATENCY.labels(endpoint="image").observe(time.perf_counter() - t0)
    return ScoreResponse(
        target="image",
        kind="image",
        score=sig["score"],
        flagged=sig["score"] >= 0.5,
        evidence=sig["evidence"],
    )


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/readyz")
def readyz() -> dict:
    return {"status": "ready"}


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
