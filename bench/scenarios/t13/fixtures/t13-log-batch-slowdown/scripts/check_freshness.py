#!/usr/bin/env python3
"""Print a compact freshness view for the latest report files."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
logs = sorted((root / "logs").glob("night-*.log"))
print(f"nightly log files: {len(logs)}")
if logs:
    print(f"oldest: {logs[0].name}")
    print(f"newest: {logs[-1].name}")
