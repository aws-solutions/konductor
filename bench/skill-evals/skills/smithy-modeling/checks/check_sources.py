import json, os, sys
files = sorted(os.path.normpath(os.path.join(r, f)) for r, _, fs in os.walk("model") for f in fs if f.endswith(".smithy"))
if len(files) < 2: sys.exit("model not split: %d .smithy files" % len(files))
b = json.load(open("smithy-build.json")); src = [os.path.normpath(s) for s in b.get("sources", []) + b.get("imports", [])]
for p in (b.get("projections") or {}).values(): src += [os.path.normpath(s) for s in p.get("imports", []) + p.get("sources", [])]
miss = [f for f in files if not any(f == s or f.startswith(s.rstrip("/") + "/") for s in src)]
sys.exit("not covered by sources: %s" % miss if miss else 0)
