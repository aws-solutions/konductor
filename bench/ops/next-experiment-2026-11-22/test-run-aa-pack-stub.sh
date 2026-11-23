#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Free test of run-aa-pack.sh's paid path with a stub bench command. No model call, no kiro-cli.
#   case 1: two bench calls, set a at replicate offset 0 and set b at 3, vanilla only, all 8 tasks, one dir per set
#   case 2: a rerun skips both sets (resume)
#   case 3: a stub that spends 250 credits on set a makes the cap guard stop before set b
#   case 4: a set dir left without .done is resumed with --resume
#   case 5: the dry run makes no bench call and ends with the expected total
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
fs.appendFileSync(path.join(path.dirname(out), 'calls.log'), a.join(' ') + '\n');
const spend = Number(process.env.STUB_SPEND || 1);
fs.writeFileSync(path.join(out, 'credit-ledger.jsonl'), JSON.stringify({ kind: 'run', unit: 'credits', arm: 'vanilla', task: 'x', replicate: 1, status: 'success', credits: spend, charged: spend, censored: false }) + '\n');
JS
fail() { echo "FAIL: $*"; exit 1; }
ENV="WAIT_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK=$T/heavy.lock"
L=runs-aa-pack/calls.log

mkdir -p "$T/a"
env $ENV STUB="node $STUBJS" HERE="$T/a" sh "$HERE0/run-aa-pack.sh" --go > "$T/a.log" 2>&1 || { cat "$T/a.log"; fail "case 1 exited non-zero"; }
[ -e "$T/a/runs-aa-pack/a.done" ] && [ -e "$T/a/runs-aa-pack/b.done" ] || fail "case 1: no .done for both sets"
[ "$(wc -l < "$T/a/$L")" = 2 ] || fail "case 1: not 2 bench calls"
grep -q -- "--arms vanilla --replicates 3 --replicate-offset 0 .*--out $T/a/runs-aa-pack/a" "$T/a/$L" || fail "case 1: set a"
grep -q -- "--arms vanilla --replicates 3 --replicate-offset 3 .*--out $T/a/runs-aa-pack/b" "$T/a/$L" || fail "case 1: set b"
grep -q -- '--tasks t8-dec-deploy-strategy,t5-qa-checkout-strategy,t5-qa-sync-strategy,t6-req-field-inspections,t2-dr-notify-fanout,t2-arch-dr-split-checkout,t7-program-brief,t1-nfr-report-queries ' "$T/a/$L" || fail "case 1: tasks"
grep -q -- '--budget-credits 150 --run-credit-limit 68' "$T/a/$L" || fail "case 1: set a budget"
echo "case 1 ok: 2 sets, offsets 0 and 3, all 8 tasks"

env $ENV STUB="node $STUBJS" HERE="$T/a" sh "$HERE0/run-aa-pack.sh" --go > "$T/b.log" 2>&1 || fail "case 2 exited non-zero"
[ "$(grep -c 'done, skipped' "$T/b.log")" = 2 ] || fail "case 2: not both skipped"
echo "case 2 ok: rerun skips both"

mkdir -p "$T/c"
if env $ENV STUB_SPEND=250 STUB="node $STUBJS" HERE="$T/c" sh "$HERE0/run-aa-pack.sh" --go > "$T/c.log" 2>&1; then fail "case 3 should stop"; fi
grep -q 'set b cannot fit one run of 68' "$T/c.log" || { cat "$T/c.log"; fail "case 3: wrong stop"; }
[ "$(wc -l < "$T/c/$L")" = 1 ] || fail "case 3: ran past the cap"
echo "case 3 ok: the cap guard stops before set b"

mkdir -p "$T/e/runs-aa-pack/a"
env $ENV STUB="node $STUBJS" HERE="$T/e" sh "$HERE0/run-aa-pack.sh" --go > "$T/e.log" 2>&1 || fail "case 4 exited non-zero"
grep -q -- "--out $T/e/runs-aa-pack/a --resume" "$T/e/$L" || fail "case 4: set a not resumed"
grep -q -- "--out $T/e/runs-aa-pack/b$" "$T/e/$L" || fail "case 4: set b should start fresh"
echo "case 4 ok: an unfinished set resumes"

mkdir -p "$T/d"
env $ENV STUB="node $STUBJS" HERE="$T/d" sh "$HERE0/run-aa-pack.sh" > "$T/d.log" 2>&1 || fail "case 5 exited non-zero"
[ ! -e "$T/d/$L" ] || fail "case 5: the dry run called the bench"
grep -q '^expected total: 240.00 of 300 credits' "$T/d.log" || { cat "$T/d.log"; fail "case 5: no expected total"; }
echo "case 5 ok: the dry run makes no call"
echo "all stub cases passed (scratch $T)"
