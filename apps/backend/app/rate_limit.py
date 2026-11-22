"""A small in-memory fixed-window rate limiter.

It lives in the process, so limits are per worker and reset on restart. That
is the right size for one small instance; several instances behind a load
balancer would need a shared store instead.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._hits: dict[str, tuple[float, int]] = {}

    def allow(self, key: str) -> bool:
        now = self._clock()
        with self._lock:
            started, count = self._hits.get(key, (now, 0))
            if now - started >= self._window:
                started, count = now, 0
            if count >= self._limit:
                return False
            self._hits[key] = (started, count + 1)
            if len(self._hits) > 10_000:
                self._forget_expired(now)
            return True

    def _forget_expired(self, now: float) -> None:
        for key in [k for k, (started, _) in self._hits.items() if now - started >= self._window]:
            del self._hits[key]
