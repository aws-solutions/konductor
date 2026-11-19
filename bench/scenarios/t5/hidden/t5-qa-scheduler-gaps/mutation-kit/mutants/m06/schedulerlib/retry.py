"""Retry execution with bounded exponential delays."""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any


class RetryFailure(RuntimeError):
    """Raised when all configured attempts fail."""


class RetryPolicy:
    def __init__(self, max_attempts: int = 3, base_delay: float = 1.0, multiplier: float = 2.0, max_delay: float = 60.0):
        if max_attempts < 1 or base_delay < 0 or multiplier < 1 or max_delay < 0:
            raise ValueError("invalid retry policy")
        self.max_attempts = max_attempts
        self.base_delay = float(base_delay)
        self.multiplier = float(multiplier)
        self.max_delay = float(max_delay)

    def delay_for(self, attempt: int) -> float:
        if attempt < 1:
            raise ValueError("attempts start at one")
        return min(self.base_delay * self.multiplier ** (attempt - 1), self.max_delay)

    def should_retry(self, attempt: int) -> bool:
        return attempt < self.max_attempts

    def run(self, operation: Callable[[], Any], sleep: Callable[[float], None] = time.sleep) -> Any:
        last_error: Exception | None = None
        for attempt in range(1, self.max_attempts + 2):
            try:
                return operation()
            except Exception as exc:
                last_error = exc
                if attempt < self.max_attempts:
                    sleep(self.delay_for(attempt))
        raise RetryFailure("operation failed after all attempts") from last_error
