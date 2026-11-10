import re, sys
t = open('dispatch-pair.sh').read()
code = [l for l in t.splitlines() if not l.lstrip().startswith('#')]
var = {m.group(1): m.group(2) for l in code for m in [re.match(r'\s*(?:export\s+)?(\w+)=["\']?([^"\'\s]+)', l)] if m}
v = []
for l in code:
    for x in re.findall(r'--cwd[ =]["\']?([^ "\'\n\\]+)', l):
        m = re.fullmatch(r'\$\{?(\w+)\}?', x)
        if m: x = var.get(m.group(1), x)
        if x.startswith('/') or x.startswith('$'): v.append(x.rstrip('/'))
sys.exit(0 if len(v) >= 2 and all(x == '/work/shop-api' for x in v) else 1)
