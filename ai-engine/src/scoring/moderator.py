"""Text & image moderation.

- Text: lexicon + caps + emoji scoring.
- Image: NSFW brand-safety heuristic. In production, calls an ONNX CLIP
  classifier; here we expose the same interface with a stub that returns
  score=0 when no model is loaded.
"""
from __future__ import annotations

import base64
import logging
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
    z += 0.5 * f["caps_ratio"] * 10
    z += 0.3 * f["exclaim"]
    score = float(sigmoid(z))
    return {
        "score": score,
        "evidence": {
            "profanity_hits": profanity_hits,
            "hate_hits": hate_hits,
            "scam_hits": scam_hits,
            "text_features": f,
        },
    }


async def image_moderation(base64_or_url: str | None) -> dict[str, Any]:
    """Stub. Real impl: load ONNX CLIP, embed, score against NSFW bank."""
    if not base64_or_url:
        return {"score": 0.0, "evidence": {"reason": "no input"}}
    try:
        if base64_or_url.startswith("data:") or len(base64_or_url) > 200:
            raw = base64.b64decode(base64_or_url.split(",", 1)[-1])
            _ = BytesIO(raw).getbuffer().nbytes
        return {"score": 0.0, "evidence": {"bytes": len(base64_or_url)}}
    except Exception as e:  # noqa: BLE001
        log.warning("image decode failed: %s", e)
        return {"score": 0.0, "evidence": {"error": "decode_failed"}}
