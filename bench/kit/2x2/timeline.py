#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""timeline.py: read-only. For every run longer than --min-sec (default 600), write a timeline that says why it ran long.

  python3 timeline.py --run STUDY/held/kiro [--run DIR ...] [--min-sec 600] [--out DIR]

DIR is a bench run dir (DIR/<arm>/<task>/<rep>/result.json). Kiro runs are read from session/*/messages.jsonl and
session/*/sub-executions/*.jsonl (they carry timestamps). Claude Code streams carry no per-event timestamps, so only the
order of events and the delegate durations are known. Nothing is written except under --out. Standard library only.
"""
import argparse, collections, glob, json, os, sys
from datetime import datetime

GAP_SEC = 45  # an idle gap is shown from this length


def ts(s):
    return datetime.strptime(s.replace('Z', '+0000'), '%Y-%m-%dT%H:%M:%S.%f%z').timestamp()


def short(x, n=110):
    x = ' '.join(str(x).split())
    return x if len(x) <= n else x[: n - 1] + '…'


def jl(path):
    out = []
    for line in open(path, errors='replace'):
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def fmt(sec):
    sec = int(round(sec))
    return f'{sec // 60}:{sec % 60:02d}'


def skill_name(args):
    """The skill a get_skill / Skill call asked for, else None."""
    if not isinstance(args, dict):
        return None
    inner = args.get('arguments') if isinstance(args.get('arguments'), dict) else args
    if 'get_skill' in json.dumps(args)[:200] or 'skill' in json.dumps(list(args.keys())):
        n = inner.get('name') or inner.get('skill') or inner.get('id')
        return None if (not n or '::' in str(n)) else n   # the schema load of get_skill itself is not a skill
    return None


def kiro(rundir, res):
    sess = glob.glob(os.path.join(rundir, 'session', 'sess_*'))
    if not sess:
        return None
    sess = sess[0]
    rows = []
    for r in jl(os.path.join(sess, 'messages.jsonl')):
        r['_who'] = 'main'
        rows.append(r)
    for f in sorted(glob.glob(os.path.join(sess, 'sub-executions', '*.jsonl'))):
        for r in jl(f):
            r['_who'] = 'sub'
            rows.append(r)
    rows = [r for r in rows if r.get('timestamp')]
    rows.sort(key=lambda r: ts(r['timestamp']))
    t0 = min(ts(r['timestamp']) for r in rows if r['payload'].get('type') in ('user', 'turn_start')) if any(r['payload'].get('type') in ('user', 'turn_start') for r in rows) else ts(rows[0]['timestamp'])
    wall = res['wallClockMs'] / 1000
    off = lambda r: ts(r['timestamp']) - t0
    acts, tools, skills, credits, subs = [], collections.Counter(), [], [], {}
    for r in rows:
        p, o = r['payload'], off(r)
        t = p.get('type')
        who = r['_who']
        if t == 'tool_call':
            name = p.get('toolName')
            sk = skill_name(p.get('args'))
            tools[(who, name)] += 1
            if sk:
                skills.append((o, who, sk))
            acts.append((o, who, 'tool', f"{name} {short(json.dumps(p.get('args', {})), 90)}"))
        elif t == 'assistant':
            acts.append((o, who, p.get('operationType', 'assistant').lower(), short(p.get('content', ''), 90)))
        elif t == 'sub_agent_start':
            subs[p['subSessionId']] = {'name': p.get('subAgentName'), 'start': o, 'end': None, 'status': None}
            acts.append((o, who, 'DELEGATE START', f"{p.get('subAgentName')}: {short(p.get('prompt', ''), 80)}"))
        elif t == 'sub_agent_complete':
            s = subs.setdefault(p['subSessionId'], {'name': '?', 'start': 0, 'end': None, 'status': None})
            s['end'], s['status'] = o, p.get('status')
            acts.append((o, who, 'DELEGATE END', f"{s['name']} {p.get('status')}"))
        elif t == 'session_metadata' and p.get('key') == 'creditSplit':
            v = p['value']
            credits.append((o, v.get('main', 0) + v.get('delegated', 0) + v.get('auxiliary', 0), v.get('main', 0), v.get('delegated', 0)))
        elif t == 'turn_end':
            acts.append((o, who, 'turn_end', p.get('stopReason')))
    end = max(a[0] for a in acts) if acts else 0
    return dict(kind='kiro', wall=wall, end=end, acts=acts, tools=tools, skills=skills, credits=credits, subs=list(subs.values()),
                events=len(rows))


def cc(rundir, res):
    rows = jl(os.path.join(rundir, 'stream.jsonl'))
    wall = res['wallClockMs'] / 1000
    acts, tools, skills, subs, think = [], collections.Counter(), [], [], 0
    for j in rows:
        t, st = j.get('type'), j.get('subtype')
        if t == 'system' and st == 'thinking_tokens':
            think = max(think, j.get('estimated_tokens', 0))
        elif t == 'assistant':
            for c in j.get('message', {}).get('content', []):
                if c.get('type') == 'tool_use':
                    tools[('main', c['name'])] += 1
                    inp = c.get('input', {})
                    if c['name'] == 'Skill':
                        skills.append((None, 'main', inp.get('skill') or inp.get('name')))
                    acts.append((None, 'main', 'tool', f"{c['name']} {short(json.dumps(inp), 90)}"))
                elif c.get('type') == 'text':
                    acts.append((None, 'main', 'say', short(c.get('text', ''), 90)))
        elif t == 'system' and st == 'task_started':
            subs.append({'name': j.get('subagent_type'), 'desc': j.get('description'), 'ms': None, 'status': 'running'})
            acts.append((None, 'main', 'DELEGATE START', f"{j.get('subagent_type')}: {short(j.get('description'), 80)}"))
        elif t == 'system' and st == 'task_notification':
            if subs:
                subs[-1]['ms'] = (j.get('usage') or {}).get('duration_ms')
                subs[-1]['status'] = j.get('status')
            acts.append((None, 'main', 'DELEGATE END', f"{j.get('status')} {(j.get('usage') or {}).get('duration_ms')} ms"))
    return dict(kind='cc', wall=wall, acts=acts, tools=tools, skills=skills, subs=subs, thinking_tokens=think, events=len(rows))


def diagnose(d):
    out = []
    wall = d['wall']
    if d['kind'] == 'kiro':
        end = d['end']
        win = [(s['start'], s['end'] if s['end'] is not None else wall) for s in d['subs']]
        inside = sum(max(0, b - a) for a, b in win)
        first_write = next((a[0] for a in d['acts'] if a[2] == 'tool' and a[3].split()[0] in ('fs_write', 'str_replace', 'fs_append')), None)
        if first_write is not None:
            out.append(f'First write to a file at {fmt(first_write)}.')
        if win:
            out.append(f'Delegates ran {fmt(inside)} of {fmt(wall)} ({inside / wall:.0%}); ' + '; '.join(
                f"{s['name']} {fmt(s['start'])} to {fmt(s['end']) if s['end'] is not None else 'the kill'} ({s['status'] or 'still running'})" for s in d['subs']) + '.')
        rep = [(k, n) for k, n in collections.Counter((s[1], s[2]) for s in d['skills']).items() if n > 1]
        out.append(f"Skill loads: {len(d['skills'])} ({len(set(s[2] for s in d['skills']))} different)" + (f"; repeated: {rep}" if rep else '; none repeated') + '.')
        gaps = []
        prev = None
        for a in d['acts']:
            if prev and a[0] - prev[0] >= GAP_SEC:
                gaps.append((a[0] - prev[0], prev, a))
            prev = a
        idle = sum(g[0] for g in gaps)
        out.append(f'{len(gaps)} gaps of {GAP_SEC} s or more, {fmt(idle)} in all; the longest {fmt(max([g[0] for g in gaps] or [0]))}.')
        if win:
            s0 = d['subs'][0]
            fw = f'The main session wrote its first file at {fmt(first_write)}' if first_write is not None else 'The main session wrote no file'
            if s0['end'] is None:
                state = f"the review delegate ({s0['name']}) was still running at the kill"
            else:
                state = f"the delegate ended at {fmt(s0['end'])} ({s0['status']}) and the main session had {fmt(wall - s0['end'])} left to act on it"
            out.append(f"**Verdict: delegated review at the end.** {fw}, started {s0['name']} at {fmt(s0['start'])}; {state}.")
        elif len(rep) >= 2:
            out.append('**Verdict: repeated skill loads.**')
        else:
            out.append('**Verdict: no delegate or loop; the time is a few long model turns.**')
    else:
        tot = sum((s['ms'] or 0) for s in d['subs']) / 1000
        out.append(f'Delegates: ' + '; '.join(f"{s['name']} ({short(s.get('desc'), 40)}) {fmt((s['ms'] or 0) / 1000)} {s['status']}" for s in d['subs']) + f'; {fmt(tot)} of {fmt(wall)} wall.')
        out.append(f"Skill loads: {len(d['skills'])} ({len(set(s[2] for s in d['skills']))} different). Thinking tokens (estimate) {d['thinking_tokens']}.")
        main = wall - tot
        out.append(f'Time outside delegates: {fmt(main)} ({main / wall:.0%}); Claude Code stream has no per-event times, so this is where it cannot be split further.')
        done = [x for x in d['subs'] if x['status'] != 'running']
        run = [x for x in d['subs'] if x['status'] == 'running']
        out.append(f"**Verdict: delegated review at the end.** {len(done)} review delegate(s) finished ({fmt(tot)} in all)" + (f"; {len(run)} more ({run[0]['desc']}) was started and still running at the kill." if run else f"; the main session then worked {fmt(main)} outside them until the kill."))
    return out


def render(path_rel, res, d):
    L = [f'# {path_rel}', '', f"status {res.get('status')}, wall {fmt(d['wall'])} ({d['wall']:.0f} s), harness {d['kind']}, {d['events']} events", '']
    L += ['## Why it ran long', ''] + [f'- {x}' for x in diagnose(d)] + ['']
    L += ['## Tool calls (who, tool, count)', '', '| who | tool | n |', '| --- | --- | --- |']
    L += [f'| {w} | {n} | {c} |' for (w, n), c in sorted(d['tools'].items(), key=lambda x: -x[1])] + ['']
    if d['skills']:
        L += ['## Skill loads', ''] + [f"- {fmt(o) if o is not None else '--'} {w}: {s}" for o, w, s in d['skills']] + ['']
    if d['subs']:
        L += ['## Delegations', '']
        for s in d['subs']:
            L.append(f"- {s['name']}: " + (f"{fmt(s['start'])} to {fmt(s['end']) if s['end'] is not None else 'kill'} ({s['status']})" if d['kind'] == 'kiro' else f"{s['status']}, {fmt((s['ms'] or 0) / 1000)}"))
        L.append('')
    if d['kind'] == 'kiro':
        if d['credits']:
            L += ['## Credits over time (main + delegates)', '', '| minute | credits | main | delegated |', '| --- | --- | --- | --- |']
            for m in range(0, int(d['wall'] // 60) + 1, 2):
                c = [x for x in d['credits'] if x[0] <= m * 60]
                if c:
                    L.append(f'| {m} | {c[-1][1]:.2f} | {c[-1][2]:.2f} | {c[-1][3]:.2f} |')
            L.append('')
        gaps, prev = [], None
        for a in d['acts']:
            if prev and a[0] - prev[0] >= GAP_SEC:
                gaps.append((prev, a))
            prev = a
        if gaps:
            L += [f'## Idle gaps of {GAP_SEC} s or more (no tool call or message logged)', '', '| from | length | after | before |', '| --- | --- | --- | --- |']
            for p, a in gaps:
                L.append(f"| {fmt(p[0])} | {fmt(a[0] - p[0])} | {p[1]} {p[2]}: {short(p[3], 50)} | {a[1]} {a[2]}: {short(a[3], 50)} |")
            L.append('')
        tail = [a for a in d['acts'] if a[0] >= d['end'] - 300]
        L += ['## The last 5 minutes before the last logged event', '']
        L += [f'- {fmt(a[0])} {a[1]} {a[2]}: {a[3]}' for a in tail[-40:]]
        L.append(f"- (kill at {fmt(d['wall'])}; last logged event at {fmt(d['end'])})")
    else:
        L += ['## Order of events (last 25)', ''] + [f'- {a[1]} {a[2]}: {a[3]}' for a in d['acts'][-25:]]
    return '\n'.join(L) + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', action='append', required=True)
    ap.add_argument('--min-sec', type=float, default=600)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    idx = []
    for run in a.run:
        for f in sorted(glob.glob(os.path.join(run, '*', '*', '*', 'result.json'))):
            if '/incomplete/' in f:
                continue
            res = json.load(open(f))
            if (res.get('wallClockMs') or 0) / 1000 < a.min_sec - 1 and res.get('status') != 'timeout':
                continue
            if (res.get('wallClockMs') or 0) / 1000 < a.min_sec - 1:
                continue
            rd = os.path.dirname(f)
            rel = os.path.relpath(rd, os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(rd))))))
            d = kiro(rd, res) if os.path.isdir(os.path.join(rd, 'session')) else cc(rd, res)
            if d is None:
                continue
            name = rel.replace('/', '__') + '.md'
            open(os.path.join(a.out, name), 'w').write(render(rel, res, d))
            verdict = [x for x in diagnose(d) if x.startswith('**Verdict')]
            idx.append((rel, res.get('status'), d['wall'], verdict[0].replace('**', '') if verdict else '', name))
    L = ['# Runs longer than %d s' % a.min_sec, '', '| run | status | wall | verdict | file |', '| --- | --- | --- | --- | --- |']
    L += [f'| {r} | {s} | {fmt(w)} | {v} | {n} |' for r, s, w, v, n in idx]
    open(os.path.join(a.out, 'timelines.md'), 'w').write('\n'.join(L) + '\n')
    print(f'{len(idx)} timeline(s) in {a.out}')


if __name__ == '__main__':
    main()
