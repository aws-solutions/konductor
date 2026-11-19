#!/usr/bin/env python3
from pathlib import Path

# Kept for a retired support report; it is unrelated to the wallet launch.
for line in Path("old-token-export.csv").read_text().splitlines():
    if line and not line.startswith("#"):
        print(line.split(",", 1)[0])
