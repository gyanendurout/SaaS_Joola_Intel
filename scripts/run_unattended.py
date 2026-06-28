"""
JOOLA Intel — Unattended pipeline runner
========================================
Wraps backend.scraping.run with:
  - All output teed to pipeline.log
  - Progress snapshot printed every 5 minutes
  - Auto-retry (up to MAX_RETRIES) if the process crashes
  - Final summary on exit

Usage (run from repo root):
    python scripts/run_unattended.py
    python scripts/run_unattended.py --module instagram
    python scripts/run_unattended.py --no-parallel --module enrichment
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────
REPO_ROOT      = Path(__file__).resolve().parents[1]
LOG_FILE       = REPO_ROOT / "pipeline.log"
# Checkpoint lives one level UP from repo root (checkpoints.py uses parents[4] from
# backend/scraping/core/checkpoints.py which resolves to c:\Workspace\)
CHECKPOINT     = REPO_ROOT.parent / "pipeline_v2_state.json"
PROGRESS_SECS  = 300          # 5 minutes — fires continuously throughout the entire run
MAX_RETRIES    = 3
RETRY_WAIT     = 90           # seconds between retries

STATUS_EMOJI = {
    "done":    "[OK]",
    "running": "[>>]",
    "failed":  "[!!]",
}

_log_lock = threading.Lock()   # protects concurrent writes to LOG_FILE


# ── Helpers ───────────────────────────────────────────────────────────────────
def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def _banner(msg: str, char: str = "═") -> str:
    bar = char * 60
    return f"\n{bar}\n  {msg}\n{bar}"


def _progress_snapshot() -> str:
    """Read checkpoint JSON and format a compact progress table."""
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

    counts = {"done": 0, "running": 0, "failed": 0, "other": 0}
    lines: list[str] = []
    for key, entry in sorted(steps.items()):
        status = entry.get("status", "?")
        emoji  = STATUS_EMOJI.get(status, "⏸")
        rows   = entry.get("rows", "-")
        err    = entry.get("error", "")
        suffix = f"  rows={rows}" if status == "done" else (f"  ERR={err[:60]}" if err else "")
        lines.append(f"  {emoji}  {key:<40} {status}{suffix}")
        counts[status if status in counts else "other"] += 1

    summary = (f"  DONE={counts['done']}  RUNNING={counts['running']}  "
               f"FAILED={counts['failed']}  total={len(steps)}")
    return summary + "\n" + "\n".join(lines)


def _log(msg: str) -> None:
    """Write to stdout and log file simultaneously, thread-safe."""
    print(msg, flush=True)
    with _log_lock:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(msg + "\n")


def _progress_thread(stop: threading.Event) -> None:
    """Background thread: write a progress snapshot every PROGRESS_SECS.

    Fires continuously for the entire run — across all retries.  Uses its own
    file handle (not shared with the pipeline reader) so there is no interleaving.
    """
    elapsed = 0
    # Emit the very first snapshot after the first interval, then repeat forever.
    while not stop.is_set():
        time.sleep(1)
        elapsed += 1
        if elapsed >= PROGRESS_SECS:
            elapsed = 0
            snap = _banner(f"PROGRESS SNAPSHOT — {_now_str()}", char="─")
            snap += "\n" + _progress_snapshot() + "\n"
            print(snap, flush=True)
            try:
                with _log_lock:
                    with open(LOG_FILE, "a", encoding="utf-8") as f:
                        f.write(snap + "\n")
            except Exception as e:
                print(f"[monitor] log write failed: {e}", flush=True)


def _run_pipeline(extra_args: list[str]) -> int:
    """Run the pipeline subprocess, tee its output to LOG_FILE, return exit code."""
    cmd = [sys.executable, "-u", "-m", "backend.scraping.run", *extra_args]
    _log(f"\n  CMD: {' '.join(cmd)}")

    # PYTHONUNBUFFERED=1 forces line-buffered stdout at the OS level, overriding
    # any sys.stdout.reconfigure() calls inside the subprocess (e.g. logger.py).
    env = {**os.environ, "PYTHONUNBUFFERED": "1"}

    proc = subprocess.Popen(
        cmd,
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,       # line-buffered on the reading side
        env=env,
    )

    for line in proc.stdout:          # type: ignore[union-attr]
        line = line.rstrip("\n")
        print(line, flush=True)
        with _log_lock:
            with open(LOG_FILE, "a", encoding="utf-8") as f:
                f.write(line + "\n")

    proc.wait()
    return proc.returncode


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Unattended JOOLA Intel pipeline runner with progress monitoring"
    )
    parser.add_argument("--module", default="all")
    parser.add_argument("--brands", default=None)
    parser.add_argument("--no-parallel", action="store_true")
    parser.add_argument("--restart",     action="store_true",
                        help="Ignore existing checkpoint, start fresh")
    parser.add_argument("--max-workers", type=int, default=8)
    parser.add_argument("--limit",       type=int, default=None)
    args = parser.parse_args()

    # Build extra args to pass through to run.py
    extra: list[str] = ["--module", args.module]
    if args.brands:
        extra += ["--brands", args.brands]
    if args.no_parallel:
        extra.append("--no-parallel")
    if args.restart:
        extra.append("--restart")
    if args.max_workers != 8:
        extra += ["--max-workers", str(args.max_workers)]
    if args.limit:
        extra += ["--limit", str(args.limit)]

    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

    header = _banner(
        f"JOOLA INTEL PIPELINE — {_now_str()}  module={args.module}",
        char="=",
    )
    _log(header)
    _log(f"  Log file    : {LOG_FILE}")
    _log(f"  Checkpoint  : {CHECKPOINT}")
    _log(f"  Max retries : {MAX_RETRIES}")
    _log(f"  Progress    : every {PROGRESS_SECS // 60} min (continuous, all retries)")

    # Progress monitor runs for the ENTIRE session — survives across retries.
    stop_evt = threading.Event()
    monitor  = threading.Thread(
        target=_progress_thread,
        args=(stop_evt,),
        daemon=True,
    )
    monitor.start()

    attempt   = 0
    exit_code = 1

    while attempt < MAX_RETRIES:
        attempt += 1
        _log(_banner(f"ATTEMPT {attempt}/{MAX_RETRIES} — {_now_str()}", "-"))

        exit_code = _run_pipeline(extra)

        if exit_code == 0:
            _log("\n  Pipeline completed successfully!")
            break

        _log(f"\n  Pipeline exited with code {exit_code}.")
        if attempt < MAX_RETRIES:
            _log(f"  Retrying in {RETRY_WAIT}s (attempt {attempt + 1}/{MAX_RETRIES})...")
            # Progress thread keeps firing every 5 min during the wait — no special handling needed
            time.sleep(RETRY_WAIT)
            if "--restart" in extra and attempt > 1:
                extra.remove("--restart")  # restart only on first attempt

    # Stop progress monitor
    stop_evt.set()
    monitor.join(timeout=3)

    # Final snapshot after all retries
    final = _banner(f"FINAL SUMMARY — {_now_str()}", "=")
    final += "\n" + _progress_snapshot()
    _log(final)

    if exit_code != 0:
        _log(f"\n  Pipeline finished with errors after {attempt} attempts.")
        _log(f"  Resume (from checkpoint): python scripts/run_unattended.py --module {args.module}")
    else:
        _log("\n  All done. Data is in Supabase.")

    _log(f"\n  Full log: {LOG_FILE}")


if __name__ == "__main__":
    main()
