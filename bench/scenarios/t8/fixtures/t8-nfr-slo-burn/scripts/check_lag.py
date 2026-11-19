#!/usr/bin/env python3
"""Small unrelated helper used by the settlement rotation."""
import csv
import sys

with open(sys.argv[1], newline="") as handle:
    rows = list(csv.DictReader(handle))
print("rows", len(rows))
