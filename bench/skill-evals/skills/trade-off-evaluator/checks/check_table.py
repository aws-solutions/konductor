import glob, re, sys
need = int(sys.argv[1])
f = sorted(glob.glob('docs/design/*-tradeoffs.md')); t = open(f[0]).read() if f else ''
ok = 0
for l in t.splitlines():
    c = [x.strip().strip('*').strip() for x in l.strip().strip('|').split('|')]
    if len(c) >= 7 and re.search('[A-Za-z]', c[0]) and all(re.fullmatch(r'\d', x) for x in c[1:6]):
        m = re.match(r'\**\s*(\d+)', c[6])
        if m and sum(map(int, c[1:6])) == int(m.group(1)): ok += 1
sys.exit(0 if ok >= need else 1)
