#!/usr/bin/env python3
import csv
import glob

errors = 0
for name in glob.glob('ops/metrics/container-*.csv'):
    with open(name, newline='', encoding='utf-8') as fh:
        for row in csv.DictReader(fh):
            errors += int(row['error_count'])
print(f'error_count={errors}')
