#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Free test of run-cc-model-swap.sh (and the CC_* overrides of run-cc-compare.sh it drives) with a stub bench command.
# No model call, no claude, no build.
#   case 1: --plan makes no bench call and prints both stages: model, arm, runs, per-run cap, expected USD and cap
#   case 2: --go --stage opus runs 8 tasks with cc-konductor only, the Opus model, USD 2 a run, task budget USD 4,
#           cap USD 32 (all 16 runs fit at their cap), under its own ROOT
#   case 3: --go --stage sonnet is refused when run-cc-compare.sh finished all 8 tasks (its cc-konductor runs are reused)
#   case 4: --go without --stage is refused
#   case 5: --summary with no runs says so for every source and exits 0
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
HERE0=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d /var/tmp/cc-model-swap-stub.XXXXXX)   # outside HOME: run-cc-compare.sh refuses a ROOT under it
trap 'rm -r -- "$T"' EXIT
STUBJS=$T/stub.js
cat > "$STUBJS" <<'JS'
// Stub for `node bench.js run ...`: logs its args; writes run-config.json and one result.json of USD 0.5 for each arm
// and replicate the command names.
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
const out = val('--out');
fs.mkdirSync(out, { recursive: true });
fs.appendFileSync(path.join(path.dirname(out), 'calls.log'), a.join(' ') + '\n');
fs.writeFileSync(path.join(out, 'run-config.json'), '{}\n');
const arms = val('--arms').split(',').map((s) => s.split('=')[0]);
for (const arm of arms) for (let rep = 1; rep <= Number(val('--replicates')); rep++) {
  const d = path.join(out, arm, val('--tasks'), String(rep));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'stream.jsonl'), '');
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ costUsd: 0.5 }) + '\n');
}
JS
fail() { echo "FAIL: $*"; exit 1; }
go() { local base=$1; shift; env WAIT_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK="$T/heavy.lock" CC_AWS_PROFILE=stub-profile \
  STUB="node $STUBJS" CCM_ROOT="$base" CC_COMPARE_ROOT="$base/cc-compare" bash "$HERE0/run-cc-model-swap.sh" "$@"; }

# case 1
go "$T/a" --plan > "$T/a.log" 2>&1 || { cat "$T/a.log"; fail "case 1 exited non-zero"; }
[ ! -e "$T/a/opus/runs/calls.log" ] && [ ! -e "$T/a/sonnet/runs/calls.log" ] || fail "case 1: a bench call"
for want in 'stage sonnet: cc-konductor on us.anthropic.claude-sonnet-5-5, 16 runs, USD 1 a run, cap USD 16' \
  'stage opus: cc-konductor on us.anthropic.claude-opus-5-5, 16 runs, USD 2 a run, cap USD 32' \
  'expected USD 10.72' 'expected USD 20.05' 'run-cc-compare.sh cc-konductor runs to reuse: 0 of 8 tasks'; do
  grep -qF -- "$want" "$T/a.log" || { cat "$T/a.log"; fail "case 1: no '$want'"; }
done
echo "case 1 ok: plan only, both stages, expected USD and caps"

# case 2
go "$T/b" --go --stage opus > "$T/b.log" 2>&1 || { cat "$T/b.log"; fail "case 2 exited non-zero"; }
[ "$(ls "$T/b/opus/runs" | grep -c '\.done$')" = 8 ] || fail "case 2: not 8 .done files"
[ "$(wc -l < "$T/b/opus/runs/calls.log")" = 8 ] || fail "case 2: not 8 bench calls"
L=$(head -n 1 "$T/b/opus/runs/calls.log")
for want in '--arms cc-konductor=f5d184596378ae72ae531d80647548512c14cacf ' '--replicates 2 --parallel 1' \
  '--model us.anthropic.claude-opus-5-5 --effort high --run-budget-usd 2' '--budget-usd 4.00' '--aws-profile stub-profile'; do
  case "$L" in *"$want"*) ;; *) fail "case 2: first call lacks '$want': $L" ;; esac
done
case "$L" in *cc-vanilla*) fail "case 2: cc-vanilla ran" ;; esac
grep -q 'all tasks done, spent USD 8.00 of 32' "$T/b.log" || { cat "$T/b.log"; fail "case 2: spend line"; }
grep -q '| t1-nfr-report-queries | 2 | 28.00 |' "$T/a.log" || { cat "$T/a.log"; fail "case 1: the Opus dry run does not reach t1"; }
echo "case 2 ok: Opus stage, cc-konductor only, USD 2 a run, cap 32"

# case 3
mkdir -p "$T/c/cc-compare/runs"
for t in t8-dec-deploy-strategy t5-qa-checkout-strategy t5-qa-sync-strategy t6-req-field-inspections t2-dr-notify-fanout \
  t2-arch-dr-split-checkout t7-program-brief t1-nfr-report-queries; do touch "$T/c/cc-compare/runs/$t.done"; done
if go "$T/c" --go --stage sonnet > "$T/c.log" 2>&1; then fail "case 3 should stop"; fi
grep -q 'reuse its cc-konductor runs' "$T/c.log" || { cat "$T/c.log"; fail "case 3: wrong stop"; }
[ ! -e "$T/c/sonnet/runs/calls.log" ] || fail "case 3: a bench call"
echo "case 3 ok: Sonnet stage refused when run-cc-compare.sh runs exist"

# case 4
if go "$T/d" --go > "$T/d.log" 2>&1; then fail "case 4 should stop"; fi
grep -q -- '--go needs --stage' "$T/d.log" || { cat "$T/d.log"; fail "case 4: wrong stop"; }
echo "case 4 ok: --go without --stage refused"

# case 5
go "$T/e" --summary > "$T/e.log" 2>&1 || { cat "$T/e.log"; fail "case 5 exited non-zero"; }
[ "$(grep -c 'no runs yet' "$T/e.log")" = 3 ] || { cat "$T/e.log"; fail "case 5: not 3 'no runs yet' lines"; }
echo "case 5 ok: summary with no runs"
echo "all stub cases passed"
