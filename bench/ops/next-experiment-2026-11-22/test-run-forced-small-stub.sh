#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Free test of run-forced-small.sh's paid path with a stub bench command. No model call, no kiro-cli.
#   case 1: both tasks run with replicates 7..12, both arms, the pinned prefix, budgets from the cap guard
#   case 2: a rerun skips both tasks (resume)
#   case 3: a stub that spends 140 credits on task 1 makes the cap guard stop before task 2
#   case 4: a changed prefix file stops the run before any bench call
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
HERE0=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d "${KIROCREW_SCRATCH:-/var/tmp}/forced-small-stub.XXXXXX")
STUBJS=$T/stub.js
cat > "$STUBJS" <<'JS'
// Stub for `node bench.js run ...`: logs its args and writes one credit-ledger line of STUB_SPEND credits.
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
const out = val('--out');
fs.mkdirSync(out, { recursive: true });
fs.appendFileSync(path.join(path.dirname(out), 'calls.log'), a.join(' ') + '\n');
const spend = Number(process.env.STUB_SPEND || 1);
fs.writeFileSync(path.join(out, 'credit-ledger.jsonl'), JSON.stringify({ kind: 'run', unit: 'credits', arm: 'vanilla', task: val('--tasks'), replicate: 7, status: 'success', credits: spend, charged: spend, censored: false }) + '\n');
JS
fail() { echo "FAIL: $*"; exit 1; }
copy() { mkdir -p "$1"; cp "$HERE0/run-forced-small.sh" "$1/"; cp -r "$KONDUCTOR_WS/reports/next-experiment-2026-11-22/prefixes" "$1/"; }
ENV="WAIT_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock"

copy "$T/a"
env $ENV STUB="node $STUBJS" HERE="$T/a" sh "$T/a/run-forced-small.sh" --go > "$T/a.log" 2>&1 || { cat "$T/a.log"; fail "case 1 exited non-zero"; }
[ "$(ls "$T/a/runs-small" | grep -c '\.done$')" = 2 ] || fail "case 1: not 2 .done files"
[ "$(wc -l < "$T/a/runs-small/calls.log")" = 2 ] || fail "case 1: not 2 bench calls"
grep -q -- '--replicates 6 --replicate-offset 6' "$T/a/runs-small/calls.log" || fail "case 1: replicates are not 7..12"
grep -q -- "--arms vanilla,konductor-forced=f5d184596378ae72ae531d80647548512c14cacf --arm-prefix konductor-forced=$T/a/prefixes/t1-nfr-report-queries.txt" "$T/a/runs-small/calls.log" || fail "case 1: arms or prefix"
grep -q -- '--budget-credits 75 --run-credit-limit 23' "$T/a/runs-small/calls.log" || fail "case 1: task budget"
echo "case 1 ok: 2 tasks, replicates 7..12"

env $ENV STUB="node $STUBJS" HERE="$T/a" sh "$T/a/run-forced-small.sh" --go > "$T/b.log" 2>&1 || fail "case 2 exited non-zero"
[ "$(grep -c 'done, skipped' "$T/b.log")" = 2 ] || fail "case 2: not both skipped"
echo "case 2 ok: rerun skips both"

copy "$T/c"
if env $ENV STUB_SPEND=140 STUB="node $STUBJS" HERE="$T/c" sh "$T/c/run-forced-small.sh" --go > "$T/c.log" 2>&1; then fail "case 3 should stop"; fi
grep -q 'cannot fit one run of 23' "$T/c.log" || { cat "$T/c.log"; fail "case 3: wrong stop"; }
[ "$(wc -l < "$T/c/runs-small/calls.log")" = 1 ] || fail "case 3: ran past the cap"
echo "case 3 ok: the cap guard stops before task 2"

copy "$T/d"
echo extra >> "$T/d/prefixes/t1-nfr-report-queries.txt"
if env $ENV STUB="node $STUBJS" HERE="$T/d" sh "$T/d/run-forced-small.sh" --go > "$T/d.log" 2>&1; then fail "case 4 should stop"; fi
grep -q 'manifest says' "$T/d.log" || { cat "$T/d.log"; fail "case 4: wrong stop"; }
[ ! -e "$T/d/runs-small/calls.log" ] || fail "case 4: a bench call ran"
echo "case 4 ok: a changed prefix stops the run"
echo "all stub cases passed (scratch $T)"
