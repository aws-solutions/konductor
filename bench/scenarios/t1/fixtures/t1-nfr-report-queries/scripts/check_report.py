#!/usr/bin/env python3
"""Print the number of rows in a generated CSV."""

import csv
import sys


def main() -> int:
    with open(sys.argv[1], newline="", encoding="utf-8") as stream:
        print(sum(1 for _ in csv.DictReader(stream)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
