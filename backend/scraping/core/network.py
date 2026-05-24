"""Network resilience layer: HTTP requests with automatic retry."""

from __future__ import annotations

import time

import requests

from .settings import NETWORK_MAX_RETRIES, NETWORK_RETRY_WAIT

_RETRYABLE = (
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    requests.exceptions.ChunkedEncodingError,
    requests.exceptions.ReadTimeout,
)


def http_request(method: str, url: str, **kwargs) -> requests.Response:
    """requests.request with retry on transient network errors.

    Tolerates ~40 min of outage (80 retries × 30 s default).
    """
    last_exc: Exception | None = None
    for attempt in range(1, NETWORK_MAX_RETRIES + 1):
        try:
            return requests.request(method, url, **kwargs)
        except _RETRYABLE as e:
            last_exc = e
            print(f"  ⚠ Network error (attempt {attempt}/{NETWORK_MAX_RETRIES}): "
                  f"{type(e).__name__}. Waiting {NETWORK_RETRY_WAIT}s …", flush=True)
            time.sleep(NETWORK_RETRY_WAIT)
    raise last_exc  # type: ignore[misc]
