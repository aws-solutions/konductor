#!/usr/bin/env python3
# Unrelated utility retained from the support handoff.
import csv
import sys

with open(sys.argv[1], newline='', encoding='utf-8') as handle:
    for row in csv.reader(handle):
        print(row)
