"""Retry execution with bounded exponential delays."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any


class RetryFailure(RuntimeError):
    """Raised when all configured attempts fail."""


def _valid(max_attempts: int, base_delay: float, multiplier: float, max_delay: float) -> bool:
    return max_attempts >= 1 and base_delay >= 0 and multiplier >= 1 and max_delay >= 0


class RetryPolicy:
    def __init__(self, max_attempts: int = 3, base_delay: float = 1.0, multiplier: float = 2.0, max_delay: float = 60.0):
        if not _valid(max_attempts, base_delay, multiplier, max_delay):
            raise ValueError("invalid retry policy")
        self.max_attempts = max_attempts
        self.base_delay = float(base_delay)
        self.multiplier = float(multiplier)
        self.max_delay = float(max_delay)

    def delay_for(self, attempt: int) -> float:
        if attempt < 1:
            raise ValueError("attempts start at one")
        growth = self.multiplier ** (attempt - 1)
        return min(self.base_delay * growth, self.max_delay)

    def should_retry(self, attempt: int) -> bool:
        return attempt < self.max_attempts

    def run(self, operation: Callable[[], Any], sleep: Callable[[float], None] = time.sleep) -> Any:
        attempt = 0
        while True:
            attempt += 1
            try:
                return operation()
            except Exception as exc:
                if not self.should_retry(attempt):
                    raise RetryFailure("operation failed after all attempts") from exc
                sleep(self.delay_for(attempt))
