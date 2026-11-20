#!/usr/bin/env python3.12
"""Prints the numbers the key of t8-heldout-rollback-decision uses, computed from the generated fixture (run from the
dir that holds fixture/): per-version soft-decline rate since the rollout, the count of reused-key declines, and the
5xx rate per version, plus the p99 window of the maps outage."""
import csv
import json
import re

ROLLOUT = '2026-11-20T13:10Z'

rows = list(csv.DictReader(open('fixture/metrics/per-minute.csv', encoding='utf-8')))
out = {}
for v in ('4.17.3', '4.18.0'):
    sel = [r for r in rows if r['version'] == v and r['minute'] >= ROLLOUT]
    att = sum(int(r['payment_auth_attempts']) for r in sel)
    dec = sum(int(r['payment_auth_soft_declines']) for r in sel)
    req = sum(int(r['requests']) for r in sel)
    err = sum(int(r['http_5xx']) for r in sel)
    out[v] = {'attempts': att, 'softDeclines': dec, 'softDeclinePct': round(100 * dec / att, 3), 'http5xxPct': round(100 * err / req, 3)}
reused = 0
for h in ('oa-1', 'oa-2', 'oa-3', 'oa-4'):
    reused += sum(1 for line in open(f'fixture/logs/orders-api/{h}.log', encoding='utf-8') if 'reason=idempotency_key_reused' in line)
gw = sum(1 for line in open('fixture/logs/payments-gateway.log', encoding='utf-8') if 'IDEMPOTENCY_KEY_REUSED' in line)
slow = [r['minute'] for r in rows if int(r['p99_latency_ms']) >= 500]
out['reusedKeyDeclines'] = reused
out['gatewayReusedLines'] = gw
out['slowMinutes'] = [slow[0], slow[-1], len(slow)] if slow else []
first = next(line for line in open('fixture/logs/orders-api/oa-3.log', encoding='utf-8') if 'reason=idempotency_key_reused' in line)
out['firstReused'] = re.match(r'\S+', first).group(0)
print(json.dumps(out, indent=1))
