"""
Resumable full-pipeline runner.

Persists per-step state to `pipeline_state.json`. On restart it skips
already-completed steps and retries failed ones. Safe to interrupt at any
time (Ctrl-C / crash / account change) and re-run.

Run:
  python -u run_resumable.py            # resume from last state
  python -u run_resumable.py --restart  # ignore prior state, start fresh
"""

import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone

from apify_to_supabase import (
    load_brand_map,
    load_ig_account_map,
    load_yt_channel_map,
    load_influencer_map,
    run_instagram_brands,
    run_youtube,
    run_reddit,
    run_products,
    run_influencers,
    run_homepage_promos,
    run_meta_ad_library,
    run_google_ads_transparency,
    run_ig_comments,
    run_yt_comments,
)

STATE_FILE = "pipeline_state.json"


# Ordered pipeline definition.
# Each entry: (step_key, callable, args_loader)
# args_loader is a function that returns the args tuple, called lazily.
def _args_brand():    return (load_brand_map(),)
def _args_ig():       return (load_ig_account_map(),)
def _args_yt():       return (load_yt_channel_map(),)
def _args_inf():      return (load_influencer_map(),)

STEPS = [
    ("ig_brands",  run_instagram_brands,         _args_ig),
    ("youtube",    run_youtube,                  _args_yt),
    ("reddit",     run_reddit,                   _args_brand),
    ("products",   run_products,                 _args_brand),
    ("influencers", run_influencers,             _args_inf),
    ("promos",     run_homepage_promos,          _args_brand),
    ("meta_ads",   run_meta_ad_library,          _args_brand),
    ("google_ads", run_google_ads_transparency,  _args_brand),
    ("ig_comments", run_ig_comments,             _args_brand),
    ("yt_comments", run_yt_comments,             _args_brand),
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_state() -> dict:
    if not os.path.exists(STATE_FILE):
        return {"run_id": _now(), "started_at": _now(), "steps": {}}
    with open(STATE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_state(state: dict) -> None:
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, default=str)
    os.replace(tmp, STATE_FILE)


def main():
    restart = "--restart" in sys.argv
    if restart and os.path.exists(STATE_FILE):
        os.rename(STATE_FILE, STATE_FILE + ".prev")
        print(f"  ⓘ Restart: archived previous state to {STATE_FILE}.prev")

    state = load_state()
    print(f"Run ID: {state['run_id']}")
    print(f"State file: {os.path.abspath(STATE_FILE)}")
    print("-" * 55)

    for key, fn, args_loader in STEPS:
        entry = state["steps"].get(key, {})
        if entry.get("status") == "done":
            print(f"  ⏭  {key:<12} skipped (done {entry.get('ended_at')[:19]}, rows={entry.get('rows')})")
            continue

        entry = {"status": "running", "started_at": _now()}
        state["steps"][key] = entry
        save_state(state)

        print(f"\n▶ {key} ({fn.__name__}) starting at {entry['started_at']}")
        try:
            args = args_loader()
            result = fn(*args)
            entry["status"]   = "done"
            entry["rows"]     = result
            entry["ended_at"] = _now()
        except KeyboardInterrupt:
            entry["status"]   = "interrupted"
            entry["ended_at"] = _now()
            state["steps"][key] = entry
            save_state(state)
            print("\n  ⓘ Interrupted by user. State saved; rerun to resume.")
            return
        except Exception as e:
            entry["status"]   = "failed"
            entry["error"]    = f"{type(e).__name__}: {e}"
            entry["traceback"] = traceback.format_exc()[-2000:]
            entry["ended_at"] = _now()
            print(f"  ✗ {key} failed: {entry['error']}")
        state["steps"][key] = entry
        save_state(state)

    state["finished_at"] = _now()
    save_state(state)
    print("\n" + "=" * 55)
    print("Pipeline finished.")
    for key, _, _ in STEPS:
        e = state["steps"].get(key, {})
        rows = e.get("rows")
        print(f"  {key:<12} {e.get('status','-'):<11} rows={rows}")
    print("=" * 55)


if __name__ == "__main__":
    main()
