#!/usr/bin/env python3
"""Create a local database containing the checked-in example."""

import sqlite3
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: load_fixture.py DATABASE", file=sys.stderr)
        return 2
    destination = Path(sys.argv[1])
    root = Path(__file__).resolve().parents[1]
    with sqlite3.connect(destination) as connection:
        connection.executescript((root / "fixtures/schema.sql").read_text())
        connection.executescript((root / "fixtures/sample.sql").read_text())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
