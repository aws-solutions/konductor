#!/bin/sh
# usage: drop.sh <id> <author> "<reason>"
# Removes a task from the tree, keeps its draft and brief in scratch ($KIROCREW_SCRATCH/t1auth/dropped), and adds a row to the
# "Dropped tasks" table of AUTHORING-LOG.md.
id=$1; author=$2; why=$3
T=$(cd "$(dirname "$0")" && pwd); K=$KIROCREW_SCRATCH/t1auth
mkdir -p "$K/dropped/briefs"
cp -r "$K/work/$id" "$K/dropped/" 2>/dev/null
rm -rf "$T/$id.json" "$T/fixtures/$id" "$T/hidden/$id" "$T/solutions/$id"
mv "$T/briefs/$id.json" "$K/dropped/briefs/" 2>/dev/null
python3 - "$T/AUTHORING-LOG.md" "$id" "$author" "$why" <<'PY'
import sys
p, i, a, w = sys.argv[1:]
s = open(p).read()
marker = "\n\nDrafts of dropped tasks are kept"
row = f"\n| {i} | {a} | {w} | see the calls table for credits |"
s = s.replace(marker, row + marker, 1)
open(p, 'w').write(s)
PY
