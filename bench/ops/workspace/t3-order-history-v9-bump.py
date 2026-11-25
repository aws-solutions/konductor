#!/usr/bin/env python3
"""Bump t3-db-order-history to v9 (owner fix of the 2026-11-24 recheck fails). Refuses if a JSON round trip changes the file."""
import json
import sys

p = sys.argv[1]
raw = open(p).read()
d = json.loads(raw)
if json.dumps(d, indent=2, ensure_ascii=False) + '\n' != raw:
    sys.exit('round trip changes the file; edit by hand')
assert d['version'] == 8 and d['handEdited']['version'] == 8
d['version'] = 9
d['handEdited']['version'] = 9
d['handEdited']['editor'] = ('mate worker (2026-11-24, owner decision): key accepts only composite-optimized '
                             '(two-table-normalized is 2.61 TB, over 2.5 TB); prototype-results.md loses the '
                             'Option 2 query plans, index designs and verdict labels (recheck S4 of v8)')
open(p, 'w').write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')
print('v9')
