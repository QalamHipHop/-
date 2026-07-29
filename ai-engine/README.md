# Rial AI Engine

Fraud, spam, scam, wash-trading, market abuse, rugpull, and risk scoring.
Recommendations, trend detection, image/text moderation. Built as a Python
FastAPI service backed by ONNX Runtime (CPU/GPU) and a Rust inference worker
for low-latency paths.

## Components

| Service              | Lang  | Port  | Purpose                                     |
|----------------------|-------|-------|---------------------------------------------|
| `api` (FastAPI)      | Py    | 3020  | REST + gRPC face for the platform           |
| `inference-py`       | Py    | 3021  | ONNX-based model serving                    |
| `inference-rust`     | Rust  | 3022  | Latency-critical feature extractors         |
| `trainer`            | Py    | —     | Offline training pipelines                  |

## Models (v1)

- `risk-v1` — supervised risk score from wallet history
- `rugpull-v1` — heuristic + LLM-hint feature extractor
- `fraud-v1` — gradient-boosted transactional features
- `rugtext-v1` — DistilBERT for token name/description risk
- `image-v1` — CLIP-based NSFW / brand-infringement scorer

## Quick start

```bash
pip install -r requirements.txt
uvicorn src.api.main:app --host 0.0.0.0 --port 3020
```

## Endpoints

- `POST /score/risk`        — risk score for a wallet
- `POST /score/rugpull`     — token launch risk
- `POST /score/fraud`       — transaction-level fraud
- `POST /score/text`        — text moderation
- `POST /score/image`       — image moderation
- `GET  /healthz`
- `GET  /readyz`
- `GET  /metrics`           — Prometheus

## Kafka events (consumed)

- `rial.trades.v1`     → real-time fraud, wash-trade
- `rial.launches.v1`   → rugpull, text/image moderation
- `rial.user_actions.v1`→ risk score updates

## Kafka events (produced)

- `rial.ai.signals.v1` — `{target, kind, score, evidence, ts}`
