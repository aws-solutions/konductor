#!/usr/bin/env python3
"""Write the STANDARD recheck record for 2026-11-24 from the S1-S7 result files."""
import json
import sys

RES = '/var/tmp/konductor-standard-recheck/results/S%d.json'
QUEUE = sys.argv[1]
OUT = sys.argv[2]
CHECKS = ['no-method-or-decoy', 'fixture-lists-no-answer', 'key-matches-fixture', 'solvable-from-fixture']

models = {}
for line in open(QUEUE):
    parts = line.split()
    if parts and parts[0].startswith('S'):
        models[parts[0]] = parts[1]

passed, failed = [], []
for i in range(1, 8):
    call = 'S%d' % i
    for tid, body in json.load(open(RES % i))['tasks'].items():
        items = {it['check']: it for it in body['items']}
        row = (call, models.get(call, '?'), tid, items)
        ok = all(items.get(c, {}).get('verdict') == 'pass' for c in CHECKS)
        (passed if ok else failed).append(row)

L = ['# STANDARD recheck results, 2026-11-24', '',
     'Source: `/var/tmp/konductor-standard-recheck/results/S1.json` to `S7.json` (19 tasks, 7 non-Claude calls).',
     'Each task got four checks. %d pass all four. %d fails.' % (len(passed), len(failed)), '',
     '## Cleared (all four checks pass)', '',
     '| Task | Call | Model | no-method-or-decoy | fixture-lists-no-answer | key-matches-fixture | solvable-from-fixture |',
     '|---|---|---|---|---|---|---|']
for call, model, tid, items in sorted(passed, key=lambda r: r[2]):
    L.append('| `%s` | %s | %s | %s |' % (tid, call, model, ' | '.join(items[c]['verdict'] for c in CHECKS)))
L += ['', '## Blocked on the author', '']
for call, model, tid, items in failed:
    L += ['### `%s` (%s, %s)' % (tid, call, model), '',
          'Status: blocked on the author. Not cleared for STANDARD. No task file was edited.', '',
          'The notes quote paths inside the recheck bundle. In the repo they are:', '',
          '- `tasks/%s/task.json` is `bench/scenarios/%s/%s.json`' % (tid, tid.split('-')[0], tid),
          '- `fixture/...` is `bench/scenarios/%s/fixtures/%s/...`' % (tid.split('-')[0], tid),
          '- `hidden/hidden/...` is `bench/scenarios/%s/hidden/%s/hidden/...`' % (tid.split('-')[0], tid), '']
    for c in CHECKS:
        it = items[c]
        L.append('- **%s: %s.** %s' % (c, it['verdict'], it['note']))
    L.append('')
open(OUT, 'w').write('\n'.join(L) + '\n')
print(len(passed), 'passed;', len(failed), 'failed:', [r[2] for r in failed])
