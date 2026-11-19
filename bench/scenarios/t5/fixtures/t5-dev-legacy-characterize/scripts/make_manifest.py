"""Make a stable list of sample files for a paper packing slip."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in sorted((ROOT / "data").glob("*.json")):
    print(path.name, path.stat().st_size)
