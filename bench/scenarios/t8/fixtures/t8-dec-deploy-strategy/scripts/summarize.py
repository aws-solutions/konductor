#!/usr/bin/env python3
import csv
import sys

with open(sys.argv[1], newline='', encoding='utf-8') as fh:
    rows = list(csv.DictReader(fh))
print('rows:', len(rows))
print('services:', ', '.join(sorted({r['service'] for r in rows})))
