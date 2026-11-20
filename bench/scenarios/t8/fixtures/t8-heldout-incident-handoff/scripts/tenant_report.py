"""Counts invoice creations per tenant in an invoice-api log.   python3 scripts/tenant_report.py logs/invoice-api.log"""
import collections
import re
import sys

counts = collections.Counter()
for line in open(sys.argv[1], encoding='utf-8'):
    if 'route=POST /v1/invoices' in line:
        m = re.search(r'tenant=(\S+)', line)
        if m:
            counts[m.group(1)] += 1
for tenant, n in counts.most_common():
    print(tenant, n)
