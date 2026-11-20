#!/usr/bin/env python3.12
"""Prints the numbers the key of t8-heldout-incident-handoff uses, computed from the generated fixture (run from the dir
that holds fixture/): the first failed invoice creation, the count of failed creations and of tenants with one, the
segments those tenants are in, and the replica lag at the end of the data."""
import csv
import json
import re

segs = dict(csv.reader(open('fixture/config/tenants.csv', encoding='utf-8')))
failed = [line for line in open('fixture/logs/invoice-api.log', encoding='utf-8') if 'route=POST /v1/invoices status=504' in line]
tenants = sorted({re.search(r'tenant=(\S+)', line).group(1) for line in failed})
rows = list(csv.DictReader(open('fixture/metrics/per-minute.csv', encoding='utf-8')))
print(json.dumps({
    'firstFailure': failed[0].split(' ')[0],
    'failedRequests': len(failed),
    'affectedTenants': len(tenants),
    'segments': sorted({segs[t] for t in tenants}),
    'enterpriseUsTenants': sum(1 for s in segs.values() if s == 'enterprise-us'),
    'lagEnd': rows[-1]['replica_replay_lag_s'],
    'p99End': rows[-1]['invoice_create_p99_ms'],
}, indent=1))
