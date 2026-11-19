#!/usr/bin/env python3
import csv
import sys

with open(sys.argv[1], newline='', encoding='utf-8') as stream:
    rows = list(csv.DictReader(stream))
print(max(rows, key=lambda row: int(row['consumer_lag'])))
