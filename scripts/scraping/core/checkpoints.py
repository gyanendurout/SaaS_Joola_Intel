"""JSON checkpoint state management for resumable pipeline runs.

Thread-safe: mutation methods take a lock so the parallel runner can write
step status from multiple workers without corrupting the JSON file.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .errors import CheckpointError

_DEFAULT_PATH = Path(__file__).resolve().parents[4] / "pipeline_v2_state.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Checkpoint:
    def __init__(self, path: Path | str | None = None) -> None:
        self._path = Path(path) if path else _DEFAULT_PATH
        self._state: dict[str, Any] = {}
        self._lock = threading.Lock()

    def load(self) -> dict[str, Any]:
        if not self._path.exists():
            self._state = {"run_id": _now(), "started_at": _now(), "steps": {}}
            return self._state
        try:
            with open(self._path, encoding="utf-8") as f:
                self._state = json.load(f)
        except Exception as e:
            raise CheckpointError(f"Cannot read checkpoint {self._path}: {e}") from e
        return self._state

    def save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._state, f, indent=2, default=str)
            os.replace(tmp, self._path)
        except Exception as e:
            raise CheckpointError(f"Cannot save checkpoint {self._path}: {e}") from e

    def reset(self) -> None:
        prev = self._path.with_suffix(".prev")
        if self._path.exists():
            os.rename(self._path, prev)
        self._state = {"run_id": _now(), "started_at": _now(), "steps": {}}

    def is_done(self, step_key: str) -> bool:
        with self._lock:
            return self._state.get("steps", {}).get(step_key, {}).get("status") == "done"

    def mark_running(self, step_key: str) -> None:
        with self._lock:
            self._state.setdefault("steps", {})[step_key] = {
                "status": "running",
                "started_at": _now(),
            }
            self.save()

    def mark_done(self, step_key: str, rows: Any = None) -> None:
        with self._lock:
            entry = self._state.setdefault("steps", {}).get(step_key, {})
            entry.update({"status": "done", "ended_at": _now(), "rows": rows})
            self._state["steps"][step_key] = entry
            self.save()

    def mark_failed(self, step_key: str, error: str, tb: str = "") -> None:
        with self._lock:
            entry = self._state.setdefault("steps", {}).get(step_key, {})
            entry.update({"status": "failed", "ended_at": _now(),
                          "error": error, "traceback": tb[-2000:]})
            self._state["steps"][step_key] = entry
            self.save()

    def summary(self) -> dict[str, Any]:
        return self._state.get("steps", {})

    @property
    def run_id(self) -> str:
        return self._state.get("run_id", "unknown")
