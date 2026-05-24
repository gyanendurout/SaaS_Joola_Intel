"""Structured logging for the v2 pipeline."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

LOG_DIR = Path(__file__).resolve().parents[4] / "logs"


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        doc: dict[str, Any] = {
            "ts": _utcnow(),
            "level": record.levelname,
            "module": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            doc["exc"] = self.formatException(record.exc_info)
        return json.dumps(doc, ensure_ascii=False)


def get_logger(name: str, *, json_file: bool = True) -> logging.Logger:
    """Return a named logger. Console output is human-readable; file output is JSON."""
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.DEBUG)

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
                                           datefmt="%H:%M:%S"))
    logger.addHandler(console)

    if json_file:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        fh = logging.FileHandler(LOG_DIR / f"pipeline-{today}.jsonl", encoding="utf-8")
        fh.setLevel(logging.DEBUG)
        fh.setFormatter(_JsonFormatter())
        logger.addHandler(fh)

    return logger
