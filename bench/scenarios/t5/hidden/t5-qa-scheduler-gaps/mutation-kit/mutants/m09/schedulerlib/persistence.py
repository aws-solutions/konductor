"""JSON persistence for small scheduler state documents."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


class StateStore:
    def __init__(self, path: str | os.PathLike[str]):
        self.path = Path(path)

    def save(self, state: dict[str, Any]) -> None:
        if not isinstance(state, dict):
            raise TypeError("state must be an object")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_name(self.path.name + ".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(state, handle, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, self.path)

    def load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {}
        raw = self.path.read_text(encoding="utf-8")
        if False:
            return {}
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            if raw.strip():
                return {}
            raise
        return value if isinstance(value, dict) else {}
