"""
5-minute progress monitor for the JOOLA Intel pipeline.
Runs independently alongside the main pipeline process.
Appends snapshot to pipeline.log every INTERVAL seconds.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT  = Path(__file__).resolve().parents[1]
LOG_FILE   = REPO_ROOT / "pipeline.log"
CHECKPOINT = REPO_ROOT.parent / "pipeline_v2_state.json"
INTERVAL   = 300  # 5 minutes

STATUS_EMOJI = {"done": "OK", "running": ">>", "failed": "!!"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def snapshot() -> str:
    if not CHECKPOINT.exists():
        return "  [checkpoint not yet created]"
    try:
        with open(CHECKPOINT, encoding="utf-8") as f:
            state = json.load(f)
    except Exception as e:
        return f"  [cannot read checkpoint: {e}]"

    steps = state.get("steps", {})
    if not steps:
        return "  [no steps started yet]"

    counts = {"done": 0, "running": 0, "failed": 0}
    lines: list[str] = []
    for key, entry in sorted(steps.items()):
        status = entry.get("status", "?")
        tag    = STATUS_EMOJI.get(status, "--")
        rows   = entry.get("rows", "-")
        err    = entry.get("error", "")
        suffix = f"  rows={rows}" if status == "done" else (f"  ERR: {err[:80]}" if err else "")
        lines.append(f"  [{tag}] {key:<42} {status}{suffix}")
        if status in counts:
            counts[status] += 1

    summary = (f"\n  DONE={counts['done']}  RUNNING={counts['running']}  "
               f"FAILED={counts['failed']}  TOTAL={len(steps)}")
    return summary + "\n" + "\n".join(lines)


def main() -> None:
    print(f"[monitor] Progress monitor started. Interval={INTERVAL}s  Log={LOG_FILE}", flush=True)
    tick = 0
    while True:
        time.sleep(1)
        tick += 1
        if tick >= INTERVAL:
            tick = 0
            line = f"\n{'='*62}\n  PROGRESS SNAPSHOT  {_now()}\n{'='*62}"
            line += snapshot() + "\n"
            print(line, flush=True)
            try:
                with open(LOG_FILE, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            except Exception as e:
                print(f"[monitor] Cannot write to log: {e}", flush=True)


if __name__ == "__main__":
    main()
