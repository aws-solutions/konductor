#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Free test of run-aa-pack.sh's paid path with a stub bench command. No model call, no kiro-cli.
#   case 1: 8 tasks x 2 sets run: set a at replicate offset 0, set b at offset 3, vanilla only, 16 .done markers
#   case 2: a rerun skips all 16 sets (resume)
#   case 3: a stub that spends 150 credits a set makes the cap guard stop before the third set
#   case 4: the dry run makes no bench call and ends with the expected total
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
HERE0=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d "${KIROCREW_SCRATCH:-/var/tmp}/aa-pack-stub.XXXXXX")
STUBJS=$T/stub.js
cat > "$STUBJS" <<'JS'
// Stub for `node bench.js run ...`: logs its args and writes one credit-ledger line of STUB_SPEND credits.
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
const out = val('--out');
fs.mkdirSync(out, { recursive: true });
fs.appendFileSync(path.join(path.dirname(path.dirname(out)), 'calls.log'), a.join(' ') + '\n');
const spend = Number(process.env.STUB_SPEND || 1);
fs.writeFileSync(path.join(out, 'credit-ledger.jsonl'), JSON.stringify({ kind: 'run', unit: 'credits', arm: 'vanilla', task: val('--tasks'), replicate: 1, status: 'success', credits: spend, charged: spend, censored: false }) + '\n');
JS
fail() { echo "FAIL: $*"; exit 1; }
ENV="WAIT_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock"

mkdir -p "$T/a"
env $ENV STUB="node $STUBJS" HERE="$T/a" sh "$HERE0/run-aa-pack.sh" --go > "$T/a.log" 2>&1 || { cat "$T/a.log"; fail "case 1 exited non-zero"; }
[ "$(find "$T/a/runs-aa-pack" -name '*.done' | wc -l)" = 16 ] || fail "case 1: not 16 .done files"
[ "$(wc -l < "$T/a/runs-aa-pack/calls.log")" = 16 ] || fail "case 1: not 16 bench calls"
[ "$(grep -c -- '--arms vanilla --replicates 3 --replicate-offset 0 ' "$T/a/runs-aa-pack/calls.log")" = 8 ] || fail "case 1: set a offsets"
[ "$(grep -c -- '--arms vanilla --replicates 3 --replicate-offset 3 ' "$T/a/runs-aa-pack/calls.log")" = 8 ] || fail "case 1: set b offsets"
grep -q -- "--out $T/a/runs-aa-pack/t6-req-field-inspections/b" "$T/a/runs-aa-pack/calls.log" || fail "case 1: set out dir"
grep -q -- '--budget-credits 68 --run-credit-limit 68' "$T/a/runs-aa-pack/calls.log" || fail "case 1: t6 budget is not its run limit"
echo "case 1 ok: 16 sets, offsets 0 and 3"

env $ENV STUB="node $STUBJS" HERE="$T/a" sh "$HERE0/run-aa-pack.sh" --go > "$T/b.log" 2>&1 || fail "case 2 exited non-zero"
[ "$(grep -c 'done, skipped' "$T/b.log")" = 16 ] || fail "case 2: not all skipped"
echo "case 2 ok: rerun skips all 16"

mkdir -p "$T/c"
if env $ENV STUB_SPEND=150 STUB="node $STUBJS" HERE="$T/c" sh "$HERE0/run-aa-pack.sh" --go > "$T/c.log" 2>&1; then fail "case 3 should stop"; fi
grep -q 'cannot fit one run of 23' "$T/c.log" || { cat "$T/c.log"; fail "case 3: wrong stop"; }
[ "$(wc -l < "$T/c/runs-aa-pack/calls.log")" = 2 ] || fail "case 3: ran past the cap"
echo "case 3 ok: the cap guard stops before the third set"

mkdir -p "$T/d"
env $ENV STUB="node $STUBJS" HERE="$T/d" sh "$HERE0/run-aa-pack.sh" > "$T/d.log" 2>&1 || fail "case 4 exited non-zero"
[ ! -e "$T/d/runs-aa-pack/calls.log" ] || fail "case 4: the dry run called the bench"
grep -q '^expected total: 240.00 of 300 credits' "$T/d.log" || { cat "$T/d.log"; fail "case 4: no expected total"; }
echo "case 4 ok: the dry run makes no call"
echo "all stub cases passed (scratch $T)"
