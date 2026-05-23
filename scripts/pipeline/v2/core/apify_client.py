"""Apify HTTP client — start actors, poll status, fetch results."""

from __future__ import annotations

import time
from typing import Any

from .errors import ActorRunError, ActorStartError
from .logger import get_logger
from .network import http_request
from .settings import APIFY_BASE, require_apify

log = get_logger("apify")


def _token() -> str:
    return require_apify()


def run_actor(actor_id: str, input_data: dict[str, Any]) -> str:
    """Start an Apify actor run. Returns run_id."""
    actor_url_id = actor_id.replace("/", "~")
    url = f"{APIFY_BASE}/acts/{actor_url_id}/runs?token={_token()}"
    resp = http_request("POST", url, json=input_data, timeout=30)
    if resp.status_code >= 400:
        raise ActorStartError(f"Actor {actor_id!r} start failed ({resp.status_code}): {resp.text[:400]}")
    run_id: str = resp.json()["data"]["id"]
    log.info("Started actor %s → run %s", actor_id, run_id)
    return run_id


def wait_for_run(run_id: str, poll_sec: int = 15, max_empty_retries: int = 5) -> bool:
    """Poll until terminal status. Returns True if SUCCEEDED."""
    url = f"{APIFY_BASE}/actor-runs/{run_id}?token={_token()}"
    empty_retries = 0
    while True:
        resp = http_request("GET", url, timeout=15)
        try:
            data = resp.json()
        except Exception:
            empty_retries += 1
            if empty_retries > max_empty_retries:
                raise
            log.warning("Run %s: empty/invalid response body (retry %d/%d)", run_id, empty_retries, max_empty_retries)
            time.sleep(poll_sec)
            continue
        status = data["data"]["status"]
        log.debug("Run %s: %s", run_id, status)
        if status == "SUCCEEDED":
            return True
        if status in ("FAILED", "TIMED-OUT", "ABORTED"):
            log.error("Run %s ended with %s", run_id, status)
            return False
        time.sleep(poll_sec)


def fetch_results(run_id: str) -> list[dict]:
    """Fetch all items from a completed actor run's dataset."""
    url = (f"{APIFY_BASE}/actor-runs/{run_id}/dataset/items"
           f"?token={_token()}&clean=true")
    resp = http_request("GET", url, timeout=120)
    resp.raise_for_status()
    return resp.json()


def run_and_fetch(actor_id: str, input_data: dict[str, Any]) -> list[dict]:
    """Convenience: start actor, wait, fetch results. Raises on failure."""
    run_id = run_actor(actor_id, input_data)
    if not wait_for_run(run_id):
        raise ActorRunError(f"Actor {actor_id!r} run {run_id} failed")
    return fetch_results(run_id)
