"""Structured logging. JSON in prod, pretty in dev."""
from __future__ import annotations

import json
import logging
import sys
import time
from typing import Any


class JSONFormatter(logging.Formatter):
    """Tiny JSON line formatter. Avoids extra deps."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        for k, v in record.__dict__.items():
            if k in payload or k.startswith("_"):
                continue
            if k in (
                "args", "asctime", "created", "exc_info", "exc_text", "filename",
                "funcName", "levelname", "levelno", "lineno", "module", "msecs",
                "message", "msg", "name", "pathname", "process", "processName",
                "relativeCreated", "stack_info", "thread", "threadName", "taskName",
            ):
                continue
            payload[k] = v
        return json.dumps(payload, ensure_ascii=False, default=str)


def setup_logging(level: str = "info") -> None:
    root = logging.getLogger()
    root.handlers.clear()
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JSONFormatter())
    root.addHandler(h)
    root.setLevel(level.upper())
    # Quiet noisy libs
    for name in ("uvicorn", "uvicorn.access", "kafka", "PIL"):
        logging.getLogger(name).setLevel(logging.WARNING)
