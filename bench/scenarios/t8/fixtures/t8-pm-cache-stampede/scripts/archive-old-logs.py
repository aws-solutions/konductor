#!/usr/bin/env python3
from pathlib import Path

# Retain the last fourteen days of local diagnostic logs.
for path in sorted(Path("logs").glob("*.log")):
    print(path)
