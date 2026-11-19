#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""table.py: read-only. Prints  prompt | expected skill | loaded first | spawned  for a PR312 functional probe run dir.

  python3 table.py --run $S/kiro      (the dir that holds <arm>/<task>/<rep>/result.json)
Loaded first = the first get_skill call in the session log (main or sub-agent, in time order), else the first entry of
result.json skillsLoaded. Spawned = sub-agents started (result.json subagentCalls). OK = loaded first is the expected skill
or one of its listed alternates.
"""
import argparse, glob, json, os

ALT = {  # a close second that is also a fair first load
    'decision-writing': ['program-decision-docs'], 'program-planning': ['sprint-planning'],
    'trade-off-evaluator': ['architecture-advisor'], 'non-functional-requirements': ['requirements-extraction'],
    'cost-estimation': ['architecture-advisor'], 'risk-management': ['program-planning'],
}
here = os.path.dirname(os.path.abspath(__file__))
exp = json.load(open(os.path.join(here, 'expected.json')))


def first_skill(rundir):
    best = None
    for f in glob.glob(os.path.join(rundir, 'session', 'sess_*', 'messages.jsonl')) + glob.glob(os.path.join(rundir, 'session', 'sess_*', 'sub-executions', '*.jsonl')):
        who = 'sub' if 'sub-executions' in f else 'main'
        for line in open(f, errors='replace'):
            try:
                r = json.loads(line)
            except ValueError:
                continue
            p = r.get('payload', {})
            if p.get('type') == 'tool_call' and 'get_skill' in json.dumps(p.get('args', {}))[:200]:
                a = p['args'].get('arguments') if isinstance(p['args'].get('arguments'), dict) else p['args']
                n = a.get('name')
                if n and '::' not in n and (best is None or r['timestamp'] < best[0]):
                    best = (r['timestamp'], n, who)
    return best


ap = argparse.ArgumentParser()
ap.add_argument('--run', required=True)
args = ap.parse_args()
print('| prompt | expected skill | loaded first | by | spawned | failed skill calls | status | OK |')
print('| --- | --- | --- | --- | --- | --- | --- | --- |')
ok = 0
n = 0
for f in sorted(glob.glob(os.path.join(args.run, '*', 'pr312-probe-*', '*', 'result.json'))):
    d = os.path.dirname(f)
    r = json.load(open(f))
    tid = r['taskId']
    num = str(int(tid.split('-')[2]))
    want = exp[num]
    fs = first_skill(d)
    if fs is None and r.get('skillsLoaded'):
        fs = ('', r['skillsLoaded'][0]['name'], '?')
    got = fs[1] if fs else 'none'
    good = got == want or got in ALT.get(want, [])
    ok += good
    n += 1
    print(f"| {tid.split('-', 3)[3]} ({num}) | {want} | {got} | {fs[2] if fs else '-'} | {r.get('subagentCalls', 0)} | {r.get('skillCallsFailed', 0)} | {r.get('status')} | {'yes' if good else 'NO'} |")
print(f'\n{ok} of {n} prompts loaded the expected skill first')
