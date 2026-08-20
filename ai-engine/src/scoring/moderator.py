"""Text & image moderation.

- Text: deterministic lexicon + caps + emoji signal.
- Image: fail-closed contract until a verified ONNX model is configured.

A missing image model is an unavailable safety decision, never a clean score.
Callers must inspect ``status`` and block or quarantine sensitive operations.
"""
from __future__ import annotations

import base64
import logging
import math
from io import BytesIO
from pathlib import Path
from typing import Any

from src.features.wallet_features import sigmoid, text_features

log = logging.getLogger(__name__)

# Compact profanity / slurs / hate lexicon. Add new entries as needed; never
# remove without sign-off from the trust & safety lead.
_PROFANITY = {
    "fuck", "shit", "bitch", "bastard", "asshole", "cunt", "dick", "piss",
}
_HATE = {
    "kike", "nigger", "faggot", "tranny", "retard", "spic", "chink",
}
_SCAM = {
    "click here", "wire transfer", "send me", "pay me first", "western union",
    "gift card", "recovery fee", "seed phrase", "private key",
}


def text_moderation(text: str) -> dict[str, Any]:
    f = text_features(text)
    lower = text.lower()
    profanity_hits = sum(1 for w in _PROFANITY if w in lower)
    hate_hits = sum(1 for w in _HATE if w in lower)
    scam_hits = sum(1 for w in _SCAM if w in lower)

    z = 0.0
    z += 1.5 * profanity_hits
    z += 3.0 * hate_hits       # much higher weight
    z += 2.5 * scam_hits
    # Sentence-initial capitalization is normal. Only sustained shouting
    # contributes to risk, avoiding false positives on ordinary prose.
    caps_excess = max(0.0, f["caps_ratio"] - 0.5)
    z += 0.5 * caps_excess * 10
    z += 0.3 * f["exclaim"]
    # Moderation score represents positive evidence; a clean text baseline is
    # 0.0 rather than sigmoid(0)=0.5.
    score = 1.0 - math.exp(-max(z, 0.0))
    return {
        "score": float(min(score, 1.0)),
        "evidence": {
            "profanity_hits": profanity_hits,
            "hate_hits": hate_hits,
            "scam_hits": scam_hits,
            "text_features": f,
        },
    }


async def image_moderation(base64_or_url: str | None) -> dict[str, Any]:
    """Return an explicit unavailable decision until an image model is loaded.

    The old implementation returned score=0 for every image, which falsely
    represented a missing classifier as a clean moderation result. Keep the
    contract deterministic, but make callers fail closed on ``status``.
    """
    if not base64_or_url:
        return {"status": "invalid", "score": None, "evidence": {"reason": "no input"}}
    try:
        if base64_or_url.startswith("data:") or len(base64_or_url) > 200:
            raw = base64.b64decode(base64_or_url.split(",", 1)[-1], validate=True)
            if not raw:
                return {"status": "invalid", "score": None, "evidence": {"reason": "empty_image"}}
            _ = BytesIO(raw).getbuffer().nbytes
        else:
            return {"status": "unavailable", "score": None, "evidence": {"reason": "image_model_not_configured"}}
        return {"status": "unavailable", "score": None, "evidence": {"reason": "image_model_not_configured", "bytes": len(raw)}}
    except Exception as e:  # noqa: BLE001
        log.warning("image decode failed: %s", e)
        return {"status": "invalid", "score": None, "evidence": {"error": "decode_failed"}}
