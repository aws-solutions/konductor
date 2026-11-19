#!/usr/bin/env python3
"""Print recent lag rows from the local metrics export."""
import csv
import sys

with open("data/metrics.csv", newline="", encoding="utf-8") as stream:
    rows = csv.DictReader(stream)
    for row in rows:
        if row["metric"] == "replication_lag_seconds":
            print(row["time_utc"], row["node"], row["value"])
