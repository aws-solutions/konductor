#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Free test of run-cc-fill.sh and cc-fill.js with a stub bench command. No model call, no claude, no AWS.
# The study folder: 6 tasks with 4 successes and .done; t5-qa-sync-strategy with cc-konductor #2 never run (no result)
# and cc-vanilla #1 an infra error; t7-program-brief with cc-vanilla #2 timed out and cc-konductor #1 a run-cap stop.
#   case 1: the plan lists t5's 2 cells to run, t7's 2 flagged cells, budget USD 3.00, fill cap USD 3.00; no bench call
#   case 2: --go moves the infra cell aside, runs t5 alone with --resume and budget 3.00, closes it, keeps t7 as it is;
#           a rerun makes no bench call
#   case 3: an error the rules cannot place (ask) stops --go before any bench call and names the cell
#   case 4: a task folder run by another bench commit (the team-mode bench) stops --go
#   case 5: --go refuses while run-cc-compare.sh (CC_MAIN_PAT) still runs
#   case 6: counted fill spend plus a task's worst case over the fill cap stops before the bench call
#   case 7: a whole task never started (no folder) runs as a fresh command, without --resume
set -eu
HERE0=$(cd "$(dirname "$0")" && pwd)
CHECK_BENCH=$(cd "$HERE0/../../.." && pwd)
T=$(mktemp -d /var/tmp/cc-fill-stub.XXXXXX)   # outside HOME: the script refuses a ROOT under it
trap 'rm -r -- "$T"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
SHA=69149846ad65f1016ec386e88ec9043bdec57203
TASKS='t8-dec-deploy-strategy t5-qa-checkout-strategy t5-qa-sync-strategy t6-req-field-inspections t2-dr-notify-fanout t2-arch-dr-split-checkout t7-program-brief t1-nfr-report-queries'

STUBJS=$T/stub.js
cat > "$STUBJS" <<'JS'
// Stub for `node bench.js run ...`: a success at USD 0.5 for each cell with no result.json (or a budget skip, with
// --resume), a ledger entry for it, and a run-config.json at the frozen bench commit.
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
const out = val('--out'), task = val('--tasks'), reps = Number(val('--replicates'));
const arms = val('--arms').split(',').map((s) => s.split('=')[0]);
fs.appendFileSync(process.env.STUB_LOG, a.join(' ') + '\n');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'run-config.json'), JSON.stringify({ benchCommit: '69149846ad65f1016ec386e88ec9043bdec57203' }));
for (const arm of arms) for (let rep = 1; rep <= reps; rep++) {
  const d = path.join(out, arm, task, String(rep));
  const res = path.join(d, 'result.json');
  if (fs.existsSync(res) && JSON.parse(fs.readFileSync(res, 'utf8')).status !== 'budget_skipped') continue;
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(res, JSON.stringify({ armId: arm, taskId: task, replicate: rep, status: 'success', costUsd: 0.5, flags: [] }));
  fs.appendFileSync(path.join(out, 'credit-ledger.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind: 'run', unit: 'usd', arm, task, replicate: rep, credits: 0.5 }) + '\n');
}
JS

cell() {   # cell ROOT TASK ARM REP JSON
  mkdir -p "$1/runs/$2/$3/$2/$4"
  echo "$5" > "$1/runs/$2/$3/$2/$4/result.json"
}
mkroot() {   # mkroot ROOT: the study folder described at the top
  local root=$1 t a r
  for t in $TASKS; do
    mkdir -p "$root/runs/$t"
    echo "{\"benchCommit\":\"$SHA\"}" > "$root/runs/$t/run-config.json"
    for a in cc-vanilla cc-konductor; do for r in 1 2; do cell "$root" "$t" "$a" "$r" '{"status":"success","costUsd":0.4}'; done; done
    touch "$root/runs/$t.done"
  done
  rm -r "$root/runs/t5-qa-sync-strategy/cc-konductor/t5-qa-sync-strategy/2" "$root/runs/t5-qa-sync-strategy.done"
  cell "$root" t5-qa-sync-strategy cc-vanilla 1 '{"status":"error","costUsd":0.01,"infraError":"Claude Code could not load AWS credentials","flags":[]}'
  cell "$root" t7-program-brief cc-vanilla 2 '{"status":"timeout","costUsd":0.6,"flags":[]}'
  cell "$root" t7-program-brief cc-konductor 1 '{"status":"error","costUsd":0.98,"flags":[]}'
}
run() {   # run ROOT [ENV=...] -- ARGS
  local root=$1; shift
  local -a envs=()
  while [ "$1" != -- ]; do envs+=("$1"); shift; done
  shift
  env KONDUCTOR_WS="$T/ws" ROOT="$root" STUB="node $STUBJS" STUB_LOG="$root/calls.log" CHECK_BENCH="$CHECK_BENCH" \
    LOAD_MAX=999 HEAVY_LOCK="$T/heavy.lock" WAIT_PAT=no-such-process-x9 CC_MAIN_PAT=no-such-process-x9 CC_AWS_PROFILE=stub \
    "${envs[@]}" bash "$HERE0/run-cc-fill.sh" "$@"
}
mkdir -p "$T/ws"

# case 1
mkroot "$T/a"
run "$T/a" -- --plan > "$T/1.log" 2>&1 || { cat "$T/1.log"; fail "case 1 exited non-zero"; }
grep -q '^| t5-qa-sync-strategy | 2 | 0 | 0 | 3.00 | 3.00 |' "$T/1.log" || { cat "$T/1.log"; fail "case 1: t5 row"; }
grep -q '^| t7-program-brief | 0 | 2 | 0 | - | - |' "$T/1.log" || { cat "$T/1.log"; fail "case 1: t7 row"; }
grep -q 'cc-vanilla 2 flag timed out' "$T/1.log" || { cat "$T/1.log"; fail "case 1: timeout not flagged"; }
grep -q 'cc-konductor 1 flag hit the USD 1 run cap' "$T/1.log" || { cat "$T/1.log"; fail "case 1: run-cap stop not flagged"; }
grep -q 'fill cap USD 3.00' "$T/1.log" || { cat "$T/1.log"; fail "case 1: fill cap"; }
[ ! -e "$T/a/calls.log" ] || fail "case 1: the plan made a bench call"
[ -e "$T/a/runs/t5-qa-sync-strategy/cc-vanilla/t5-qa-sync-strategy/1/result.json" ] || fail "case 1: the plan moved a cell"
echo "case 1 ok: plan shows t5's 2 cells, t7's 2 flagged cells, cap USD 3.00"

# case 2
run "$T/a" -- --go > "$T/2.log" 2>&1 || { cat "$T/2.log"; fail "case 2 exited non-zero"; }
[ "$(wc -l < "$T/a/calls.log")" = 1 ] || { cat "$T/a/calls.log"; fail "case 2: not one bench call"; }
grep -q -- '--tasks t5-qa-sync-strategy .*--budget-usd 3.00 --out .*--resume' "$T/a/calls.log" || { cat "$T/a/calls.log"; fail "case 2: wrong call"; }
grep -q -- "--repo-root $T/ws/worktrees/cc-frozen-69149846 " "$T/a/calls.log" || fail "case 2: not the study's own frozen bench"
grep -q -- '--run-budget-usd 1 ' "$T/a/calls.log" || fail "case 2: the run cap is not USD 1"
V=$T/a/runs/t5-qa-sync-strategy/cc-vanilla/t5-qa-sync-strategy
[ -e "$V/1.prefill-1/attempt-result.json" ] && [ ! -e "$V/1.prefill-1/result.json" ] || fail "case 2: the infra cell was not moved aside"
grep -q '"status":"success"' "$V/1/result.json" || fail "case 2: the infra cell was not run again"
[ -e "$T/a/runs/t5-qa-sync-strategy.done" ] || { cat "$T/2.log"; fail "case 2: t5 has no .done"; }
grep -q '"status":"timeout"' "$T/a/runs/t7-program-brief/cc-vanilla/t7-program-brief/2/result.json" || fail "case 2: the flagged timeout changed"
run "$T/a" -- --go > "$T/2r.log" 2>&1 || { cat "$T/2r.log"; fail "case 2 rerun exited non-zero"; }
[ "$(wc -l < "$T/a/calls.log")" = 1 ] || fail "case 2: the rerun made a bench call"
echo "case 2 ok: infra cell moved aside, t5 run alone and closed, flagged cells kept"

# case 3
mkroot "$T/b"
cell "$T/b" t2-dr-notify-fanout cc-konductor 2 '{"status":"error","costUsd":0.2,"error":"something odd","flags":[]}'
if run "$T/b" -- --go > "$T/3.log" 2>&1; then fail "case 3 should stop"; fi
grep -q 'owner must rule' "$T/3.log" && grep -q 't2-dr-notify-fanout cc-konductor 2' "$T/3.log" || { cat "$T/3.log"; fail "case 3: wrong stop"; }
[ ! -e "$T/b/calls.log" ] || fail "case 3: a bench call was made"
echo "case 3 ok: an ask cell stops the fill"

# case 4
mkroot "$T/c"
echo '{"benchCommit":"e7ed4d5581728c8839c7d95a7d181693f84dbb31"}' > "$T/c/runs/t5-qa-sync-strategy/run-config.json"
if run "$T/c" -- --go > "$T/4.log" 2>&1; then fail "case 4 should stop"; fi
grep -q 'was run by bench e7ed4d55' "$T/4.log" || { cat "$T/4.log"; fail "case 4: wrong stop"; }
[ ! -e "$T/c/calls.log" ] || fail "case 4: a bench call was made"
echo "case 4 ok: a folder of another bench commit stops the fill"

# case 5
mkroot "$T/d"
sleep 987.25 & SP=$!
if run "$T/d" CC_MAIN_PAT='sleep 987[.]25' -- --go > "$T/5.log" 2>&1; then kill "$SP"; fail "case 5 should stop"; fi
kill "$SP"
grep -q 'run-cc-compare.sh is still running' "$T/5.log" || { cat "$T/5.log"; fail "case 5: wrong stop"; }
[ ! -e "$T/d/calls.log" ] || fail "case 5: a bench call was made"
echo "case 5 ok: no fill while the main study runs"

# case 6: a frozen fill that already spent USD 2.5 (a ledger entry after its start): 2.5 + 3.00 > 3.00
mkroot "$T/e"
run "$T/e" -- --plan > /dev/null 2>&1
echo "2026-01-01T00:00:00.000Z" > "$T/e/fill-start"
printf 't5-qa-sync-strategy cc-vanilla 1\nt5-qa-sync-strategy cc-konductor 2\n' > "$T/e/fill-cells.txt"
echo '{"at":"2026-01-02T00:00:00.000Z","kind":"run","unit":"usd","arm":"cc-vanilla","task":"t5-qa-sync-strategy","replicate":1,"credits":2.5}' >> "$T/e/runs/t5-qa-sync-strategy/credit-ledger.jsonl"
if run "$T/e" -- --go > "$T/6.log" 2>&1; then fail "case 6 should stop"; fi
grep -q 'counted USD 2.50 of 3.00' "$T/6.log" || { cat "$T/6.log"; fail "case 6: wrong stop"; }
[ ! -e "$T/e/calls.log" ] || fail "case 6: a bench call was made"
echo "case 6 ok: the fill cap stops before the bench call"

# case 7: t1 never started (the main study stopped before it)
mkroot "$T/f"
rm -r "$T/f/runs/t1-nfr-report-queries" "$T/f/runs/t1-nfr-report-queries.done"
run "$T/f" -- --go > "$T/7.log" 2>&1 || { cat "$T/7.log"; fail "case 7 exited non-zero"; }
grep -q -- '--tasks t1-nfr-report-queries .*--budget-usd 6.00 --out [^ ]*t1-nfr-report-queries$' "$T/f/calls.log" || { cat "$T/f/calls.log"; fail "case 7: t1 not run fresh with budget 6.00"; }
[ -e "$T/f/runs/t1-nfr-report-queries.done" ] || fail "case 7: t1 has no .done"
echo "case 7 ok: a task that never started runs fresh"
echo "all cc-fill cases passed"
