"""A small stable priority queue."""

from __future__ import annotations

import heapq
from typing import Any


class PriorityQueue:
    def __init__(self) -> None:
        self._items: list[tuple[int, int, Any]] = []
        self._sequence = 0

    def put(self, item: Any, priority: int = 0) -> None:
        heapq.heappush(self._items, (-priority, -self._sequence, item))
        self._sequence += 1

    def get(self) -> Any:
        if not self._items:
            raise IndexError("get from empty priority queue")
        return heapq.heappop(self._items)[2]

    def __len__(self) -> int:
        return len(self._items)

    def empty(self) -> bool:
        return not self._items
