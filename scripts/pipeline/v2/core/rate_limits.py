"""Simple rate limiting helpers."""

from __future__ import annotations

import time
from collections import deque
from datetime import datetime, timezone


class RateLimiter:
    """Token-bucket style rate limiter.

    Example — max 5 calls per second:
        rl = RateLimiter(max_calls=5, period=1.0)
        rl.wait()
    """

    def __init__(self, max_calls: int, period: float) -> None:
        self._max = max_calls
        self._period = period
        self._calls: deque[float] = deque()

    def wait(self) -> None:
        now = time.monotonic()
        while len(self._calls) >= self._max:
            oldest = self._calls[0]
            elapsed = now - oldest
            if elapsed >= self._period:
                self._calls.popleft()
            else:
                time.sleep(self._period - elapsed + 0.01)
                now = time.monotonic()
        self._calls.append(now)


def exponential_backoff(attempt: int, base: float = 2.0, cap: float = 60.0) -> float:
    """Return sleep duration for attempt (0-indexed) with capped exponential backoff."""
    return min(base ** attempt, cap)


def sleep_with_jitter(seconds: float, jitter: float = 0.1) -> None:
    import random
    time.sleep(seconds + random.uniform(0, jitter * seconds))
