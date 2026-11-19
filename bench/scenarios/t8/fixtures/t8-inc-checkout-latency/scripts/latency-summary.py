#!/usr/bin/env python3
"""Print minutes whose checkout p99 exceeds a selected threshold."""
import csv
import sys

threshold = int(sys.argv[1]) if len(sys.argv) > 1 else 1200
with open("metrics/checkout-minute.csv", newline="", encoding="utf-8") as source:
    for row in csv.DictReader(source):
        if int(row["p99_ms"]) > threshold:
            print(row["timestamp"], row["p99_ms"], row["pool_waiters"])
