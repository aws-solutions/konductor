#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Free test of run-model-swap-judge.sh and model-swap-judge.js with a stub bench command. No model call, no AWS.
#   case 1: --plan makes only --plan judge calls, one per task with a ran cell, and prints the USD estimate
#   case 2: the paid path judges 8 task copies with the arm renamed to konductor-opus (result.json and run-config too),
#           drops the never-ran cells, leaves the raw runs as they were, and writes both reports over the Opus copies
#           and the reused Sonnet LITE judge dirs
#   case 3: a rerun skips every judged task (resume) and makes no judge call
#   case 4: a judge pass that spends USD 0.9 a task stops before task 3 (spent 1.8 plus one task's worst case 0.3 > 2)
#   case 5: CAP_USD above the approved USD 2 is refused before any bench call
set -eu
HERE0=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d "${KIROCREW_SCRATCH:-/var/tmp}/msj-stub.XXXXXX")
trap 'rm -r -- "$T"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

TASKS='t8-dec-deploy-strategy t5-qa-checkout-strategy t5-qa-sync-strategy t6-req-field-inspections t2-dr-notify-fanout t2-arch-dr-split-checkout t7-program-brief t1-nfr-report-queries'

# A made-up workspace: the Opus natural stage (3 cells a task; t1 has 1 run and 2 budget-skipped cells), the LITE judge
# dirs with Sonnet judgments, and a git repo standing in for the frozen judge bench.
mkws() {
  local ws=$1 t b r d st
  for t in $TASKS; do
    for r in 1 2 3; do
      d=$ws/reports/next-experiment-2026-11-22/runs-model-swap/natural/$t/konductor/$t/$r
      mkdir -p "$d/workspace"
      st=success; [ "$t" = t1-nfr-report-queries ] && [ "$r" != 1 ] && st=budget_skipped
      echo "{\"armId\":\"konductor\",\"taskId\":\"$t\",\"replicate\":$r,\"status\":\"$st\",\"credits\":10}" > "$d/result.json"
    done
    echo '{"armIds":["konductor"],"arms":[{"id":"konductor","ref":"f5d18459"}]}' > "$ws/reports/next-experiment-2026-11-22/runs-model-swap/natural/$t/run-config.json"
  done
  for b in t1 t2 t5 t6 t7 t8; do for r in 1 2 3; do
    d=$ws/reports/lite-run-2026-11-21/judge/runs/r$r-$b
    mkdir -p "$d"
    echo '{"rubric":[]}' > "$d/judgments.json"
  done; done
  b=$ws/reports/lite-run-2026-11-21/judge/bench
  mkdir -p "$b/bench/scenarios/t1" "$b/bench/scenarios/t2" "$b/bench/scenarios/t5" "$b/bench/scenarios/t6" "$b/bench/scenarios/t7" "$b/bench/scenarios/t8"
  for x in t1 t2 t5 t6 t7 t8; do echo '{}' > "$b/bench/scenarios/$x/pack.json"; done
  git -C "$b" init -q
  git -C "$b" add -A
  git -C "$b" -c user.name=stub -c user.email=stub@example.com commit -qm stub
}

STUBJS=$T/stub.js
cat > "$STUBJS" <<'JS'
// Stub for `node bench.js judge|report ...`: logs its args next to the judge dir. A paid judge call (no --plan) writes
// a USD ledger line of STUB_USD into the run it judged, as the real judge does.
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
fs.appendFileSync(process.env.STUB_LOG, a.join(' ') + '\n');
if (a[0] === 'judge' && !a.includes('--plan')) {
  fs.appendFileSync(path.join(val('--run'), 'credit-ledger.jsonl'), JSON.stringify({ unit: 'usd', usd: Number(process.env.STUB_USD || 0.05) }) + '\n');
  console.log('judged 9 rubric, 0 pairwise and 0 graded record(s)');
}
if (a[0] === 'report') fs.mkdirSync(val('--out'), { recursive: true });
JS

run() {   # ws, then extra env, then script args after --
  local ws=$1; shift
  local -a envs=()
  while [ "$1" != -- ]; do envs+=("$1"); shift; done
  shift
  env KONDUCTOR_WS="$ws" STUB="node $STUBJS" STUB_LOG="$ws/calls.log" \
    BENCH_SHA="$(git -C "$ws/reports/lite-run-2026-11-21/judge/bench" rev-parse HEAD)" "${envs[@]}" \
    bash "$HERE0/run-model-swap-judge.sh" "$@"
}

# case 1
mkws "$T/a"
run "$T/a" -- --plan > "$T/a1.log" 2>&1 || { cat "$T/a1.log"; fail "case 1 exited non-zero"; }
[ "$(grep -c '^judge ' "$T/a/calls.log")" = 8 ] || fail "case 1: not 8 judge --plan calls"
[ "$(grep -c -- '--plan' "$T/a/calls.log")" = 8 ] || fail "case 1: a judge call without --plan"
grep -q -- '--judges gpt-5.6-luna,deepseek-3.2,qwen3-coder-next --mode rubric' "$T/a/calls.log" || fail "case 1: panel or mode not passed"
grep -q 'Opus runs to judge: 22' "$T/a1.log" || { cat "$T/a1.log"; fail "case 1: run count is not 22"; }
grep -q 'estimated USD' "$T/a1.log" || fail "case 1: no USD estimate"
[ ! -e "$T/a/reports/next-experiment-2026-11-22/judge-model-swap/runs" ] || fail "case 1: --plan made judge copies"
echo "case 1 ok: plan only, 22 runs, estimate printed"

# case 2
: > "$T/a/calls.log"
run "$T/a" -- > "$T/a2.log" 2>&1 || { cat "$T/a2.log"; fail "case 2 exited non-zero"; }
J=$T/a/reports/next-experiment-2026-11-22/judge-model-swap
[ "$(grep -c '^judge ' "$T/a/calls.log")" = 8 ] || fail "case 2: not 8 judge calls"
grep -q -- '--plan' "$T/a/calls.log" && fail "case 2: a --plan call on the paid path"
[ "$(ls "$J/runs" | grep -c '[.]done$')" = 8 ] || fail "case 2: not 8 .done"
C=$J/runs/t8-dec-deploy-strategy
[ -d "$C/konductor-opus/t8-dec-deploy-strategy/3" ] && [ ! -e "$C/konductor" ] || fail "case 2: arm not renamed"
grep -q '"armId":"konductor-opus"' "$C/konductor-opus/t8-dec-deploy-strategy/1/result.json" || fail "case 2: result.json armId not rewritten"
grep -q '"konductor-opus"' "$C/run-config.json" && ! grep -q '"konductor"' "$C/run-config.json" || fail "case 2: run-config not rewritten"
[ "$(ls "$J/runs/t1-nfr-report-queries/konductor-opus/t1-nfr-report-queries")" = 1 ] || fail "case 2: budget-skipped cells kept"
[ -d "$T/a/reports/next-experiment-2026-11-22/runs-model-swap/natural/t8-dec-deploy-strategy/konductor" ] || fail "case 2: raw run changed"
[ "$(grep -c '^report ' "$T/a/calls.log")" = 2 ] || fail "case 2: not 2 report calls"
grep '^report ' "$T/a/calls.log" | grep -q -- '--baseline vanilla' || fail "case 2: no vanilla-baseline report"
grep '^report ' "$T/a/calls.log" | grep -q -- '--baseline konductor ' || fail "case 2: no Sonnet-konductor-baseline report"
grep '^report ' "$T/a/calls.log" | head -1 | grep -q 'lite-run-2026-11-21/judge/runs/r3-t8' || fail "case 2: Sonnet LITE dirs not in the report"
[ "$(grep '^report ' "$T/a/calls.log" | head -1 | tr ',' '\n' | grep -c 'lite-run-2026-11-21/judge/runs/r')" = 18 ] || fail "case 2: not 18 LITE dirs"
echo "case 2 ok: 8 copies judged, arm renamed, raw kept, 2 reports"

# case 3
: > "$T/a/calls.log"
run "$T/a" -- > "$T/a3.log" 2>&1 || { cat "$T/a3.log"; fail "case 3 exited non-zero"; }
[ "$(grep -c 'judged, skipped' "$T/a3.log")" = 8 ] || fail "case 3: not every task skipped"
[ "$(grep -c '^judge ' "$T/a/calls.log")" = 0 ] || fail "case 3: a judge call on resume"
echo "case 3 ok: rerun skips all 8"

# case 4
mkws "$T/b"
if run "$T/b" STUB_USD=0.9 -- > "$T/b.log" 2>&1; then fail "case 4 should stop"; fi
grep -q 'STOP: spent USD 1.8 of the USD 2 cap' "$T/b.log" || { cat "$T/b.log"; fail "case 4: wrong stop"; }
[ "$(grep -c '^judge ' "$T/b/calls.log")" = 2 ] || fail "case 4: not 2 judge calls before the stop"
echo "case 4 ok: cap guard stops before task 3"

# case 5
mkws "$T/c"
if run "$T/c" CAP_USD=3 -- > "$T/c.log" 2>&1; then fail "case 5 should stop"; fi
grep -q 'outside the approved USD 2' "$T/c.log" || { cat "$T/c.log"; fail "case 5: wrong stop"; }
[ ! -e "$T/c/calls.log" ] || fail "case 5: a bench call before the refusal"
echo "case 5 ok: cap above USD 2 refused"
echo "all cases ok"
