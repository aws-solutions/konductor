"""A small stable priority queue."""

from __future__ import annotations

import bisect
import itertools
from typing import Any


class PriorityQueue:
    def __init__(self) -> None:
        # Kept sorted by (priority descending, arrival order); the next item is at the front.
        self._entries: list[tuple[int, int, Any]] = []
        self._arrivals = itertools.count()

    def put(self, item: Any, priority: int = 0) -> None:
        entry = (-priority, next(self._arrivals), item)
        keys = [e[:2] for e in self._entries]
        self._entries.insert(bisect.bisect_right(keys, entry[:2]), entry)

    def get(self) -> Any:
        if not self._entries:
            raise IndexError("get from empty priority queue")
        return self._entries.pop(0)[2]

    def __len__(self) -> int:
        return len(self._entries)

    def empty(self) -> bool:
        return len(self) == 0
