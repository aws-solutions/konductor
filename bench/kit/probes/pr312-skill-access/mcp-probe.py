#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""mcp-probe.py: free, no model. Start the konductor-skills MCP server exactly as an installed Kiro konductor agent does,
call tools/list, then get_skill for every skill name given, and print one JSON line per name.

  python3 mcp-probe.py --home HOME_WITH_INSTALL --names a,b,c   (names default: every skill folder in HOME/.konductor/skills)
Reads HOME/.kiro/agents/konductor.json for the server command and arguments; drops --install-info. Standard library only.
"""
import argparse, json, os, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument('--home', required=True)
ap.add_argument('--names', default='')
a = ap.parse_args()
home = os.path.abspath(a.home)
spec = json.load(open(os.path.join(home, '.kiro/agents/konductor.json')))['mcpServers']['konductor-skills']
args = list(spec['args'])
if '--install-info' in args:
    i = args.index('--install-info')
    del args[i:i + 2]
cmd = [spec['command'].replace('~', home)] + [x.replace('~', home) for x in args]
env = dict(os.environ, HOME=home)
p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, cwd=home, text=True, bufsize=1)
_id = [0]


def call(method, params=None, notify=False):
    msg = {'jsonrpc': '2.0', 'method': method}
    if params is not None:
        msg['params'] = params
    if not notify:
        _id[0] += 1
        msg['id'] = _id[0]
    p.stdin.write(json.dumps(msg) + '\n')
    p.stdin.flush()
    if notify:
        return None
    while True:
        line = p.stdout.readline()
        if not line:
            raise SystemExit('server closed')
        r = json.loads(line)
        if r.get('id') == _id[0]:
            return r


call('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'pr312-probe', 'version': '1'}})
call('notifications/initialized', {}, notify=True)
tools = [t['name'] for t in call('tools/list')['result']['tools']]
print(json.dumps({'tools': tools}))
names = [n for n in a.names.split(',') if n] or sorted(os.listdir(os.path.join(home, '.konductor/skills')))
for n in names:
    r = call('tools/call', {'name': 'get_skill', 'arguments': {'name': n}})
    res = r.get('result') or {}
    text = ''.join(c.get('text', '') for c in res.get('content', []) if isinstance(c, dict))
    err = bool(res.get('isError')) or 'error' in r
    out = {'name': n, 'ok': (not err) and len(text) > 200 and '"not found"' not in text.lower()[:200], 'chars': len(text)}
    if not out['ok']:
        out['reply'] = (text or json.dumps(r.get('error', r)))[:240]
    print(json.dumps(out))
p.stdin.close()
p.terminate()
