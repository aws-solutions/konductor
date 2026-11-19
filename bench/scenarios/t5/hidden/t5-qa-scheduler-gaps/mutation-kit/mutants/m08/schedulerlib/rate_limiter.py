"""Sliding-window request limiting."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Callable


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float, clock: Callable[[], float] = time.monotonic):
        if limit < 1 or window_seconds <= 0:
            raise ValueError("limit and window must be positive")
        self.limit = limit
        self.window_seconds = float(window_seconds)
        self.clock = clock
        self._events: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str = "default", now: float | None = None) -> bool:
        current = self.clock() if now is None else float(now)
        events = self._events[key]
        while events and current - events[0] > self.window_seconds:
            events.popleft()
        if len(events) >= self.limit:
            return False
        events.append(current)
        return True

    def reset(self, key: str | None = None) -> None:
        if key is None:
            self._events.clear()
        else:
            self._events.pop(key, None)
