#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Free test of run-cc-team.sh and cc-team-reuse.js (and the run-cc-compare.sh overrides they drive) with a stub bench,
# judge and re-score. No model call, no claude, no build, no AWS.
# The saved study: 8 tasks, cc-vanilla and cc-konductor x 2 replicates, all success at the study's setup; each
# cc-konductor run costs USD 0.5 (rep 1) and 0.7 (rep 2), so the new arm is expected at USD 1.20 a task, 9.60 in all.
#   case 1: --plan makes no bench call, reuses 32 saved runs, prints the expected USD, the dry run (task budget 2.00,
#           worst case reaching t1) and the cap USD 16
#   case 2: --plan stops when a saved task ran another model (the reuse would not be valid), naming task and field
#   case 3: --go runs 8 tasks with cc-konductor-team only, USD 1 a run, budget 2.00, under the team ROOT; a rerun skips
#   case 4: --go refuses while another paid owner job runs (BUSY_PAT)
#   case 5: --judge and --judge-plan call the judge script on the team ROOT with cap USD 1, its own report and the
#           study's 8 judged copies added to the report
#   case 6: --rescore calls the re-score on the team runs, arm cc-konductor-team, its own TSV and the newest-key bench
#   case 7: --loads with no team runs says so and exits 0
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (run-cc-compare.sh reads task versions from its konductor-plant)}"
HERE0=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d /var/tmp/cc-team-stub.XXXXXX)   # outside HOME: run-cc-compare.sh refuses a ROOT under it
trap 'rm -r -- "$T"' EXIT
. "$(dirname "$0")/../lib.sh"   # say, stop and fail (B-005)
SHA=69149846ad65f1016ec386e88ec9043bdec57203
KSHA=f5d184596378ae72ae531d80647548512c14cacf
TASKS='t8-dec-deploy-strategy t5-qa-checkout-strategy t5-qa-sync-strategy t6-req-field-inspections t2-dr-notify-fanout t2-arch-dr-split-checkout t7-program-brief t1-nfr-report-queries'

STUBJS=$T/stub.js
cat > "$STUBJS" <<'JS'
// Stub for `node bench.js run ...`: logs its args; writes run-config.json and one USD 0.5 result per arm and replicate.
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
const out = val('--out');
fs.mkdirSync(out, { recursive: true });
fs.appendFileSync(path.join(path.dirname(out), 'calls.log'), a.join(' ') + '\n');
fs.writeFileSync(path.join(out, 'run-config.json'), '{}\n');
for (const arm of val('--arms').split(',').map((s) => s.split('=')[0])) for (let rep = 1; rep <= Number(val('--replicates')); rep++) {
  const d = path.join(out, arm, val('--tasks'), String(rep));
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'stream.jsonl'), '');
  fs.writeFileSync(path.join(d, 'result.json'), JSON.stringify({ costUsd: 0.5 }) + '\n');
}
JS
# Judge and re-score stubs: log their args and the env the wrapper sets.
cat > "$T/judge.sh" <<'SH'
echo "judge $* ROOT=$ROOT CAP_USD=$CAP_USD REPORT=$CC_JUDGE_REPORT ALSO=$CC_JUDGE_ALSO" >> "$STUB_LOG"
SH
cat > "$T/rescore.sh" <<'SH'
echo "rescore CC_RUNS=$CC_RUNS CC_ARMS=$CC_ARMS DEST=$CC_SCORES_DEST FIXED=$FIXED_BENCH SCRATCH=$KIROCREW_SCRATCH" >> "$STUB_LOG"
SH

mkstudy() {   # mkstudy DIR: the saved study described at the top
  local d=$1/runs t a r
  for t in $TASKS; do
    mkdir -p "$d/$t" "$1/judge/runs/$t"
    cat > "$d/$t/run-config.json" <<EOF
{"benchCommit":"$SHA","model":"us.anthropic.claude-sonnet-5-5","harnessVersion":"2.1.330.1791","seed":20261121,"effort":"high","replicates":2,"armIds":["cc-vanilla","cc-konductor=$KSHA"],"isolation":{"mode":"unshare"},"claudeCode":{"maxBudgetUsdPerRun":1}}
EOF
    for a in cc-vanilla cc-konductor; do for r in 1 2; do
      mkdir -p "$d/$t/$a/$t/$r"
      echo "{\"status\":\"success\",\"model\":\"us.anthropic.claude-sonnet-5-5\",\"harnessVersion\":\"2.1.330.1791\",\"costUsd\":0.$((r * 2 + 3))}" > "$d/$t/$a/$t/$r/result.json"
    done; done
    touch "$d/$t.done" "$1/judge/runs/$t.done"
    echo 'judged 12 rubric, 0 pairwise and 0 graded record(s); 0 with judgeError; live spend $0.0800 USD (all invocations: $0.0800), 0 credits' > "$1/judge/runs/$t-judge.log"
  done
}
go() {   # go STUDY TEAMROOT [ENV=...] -- ARGS
  local study=$1 team=$2; shift 2
  local -a envs=()
  while [ "$1" != -- ]; do envs+=("$1"); shift; done
  shift
  env WAIT_PAT=no-such-process-x9 LOAD_MAX=999 HEAVY_LOCK="$T/heavy.lock" CC_AWS_PROFILE=stub-profile \
    STUB="node $STUBJS" STUB_LOG="$T/stub.log" CC_COMPARE_ROOT="$study" CC_TEAM_ROOT="$team" BUSY_PAT=no-such-process-x9 \
    CC_JUDGE_SH="$T/judge.sh" CC_RESCORE_SH="$T/rescore.sh" FIXED_BENCH="$T/keys/bench" "${envs[@]}" \
    bash "$HERE0/run-cc-team.sh" "$@"
}
mkstudy "$T/s"

# case 1
go "$T/s" "$T/a" -- --plan > "$T/1.log" 2>&1 || { cat "$T/1.log"; fail "case 1 exited non-zero"; }
[ ! -e "$T/a/runs/calls.log" ] || fail "case 1: a bench call"
for want in 'reused: 32 saved runs (16 cc-vanilla, 16 cc-konductor), 8 of 8 tasks' '| t8-dec-deploy-strategy | 0.50 | 0.70 | 1.20 |' \
  'expected USD 9.60 for 16 runs' 'cap USD 16' '| t8-dec-deploy-strategy | 2 | 0.00 | 2.00 | 2.00 |' '| t1-nfr-report-queries | 2 |' \
  'judge: expected USD 0.32'; do
  grep -qF -- "$want" "$T/1.log" || { cat "$T/1.log"; fail "case 1: no '$want'"; }
done
echo "case 1 ok: plan only, 32 reused runs, expected USD 9.60, cap 16"

# case 2
cp -a "$T/s" "$T/s2"
sed -i 's/claude-sonnet-5-5"/claude-opus-5-5"/' "$T/s2/runs/t5-qa-sync-strategy/run-config.json"
if go "$T/s2" "$T/b" -- --plan > "$T/2.log" 2>&1; then fail "case 2 should stop"; fi
grep -qF 't5-qa-sync-strategy: model is us.anthropic.claude-opus-5-5, want us.anthropic.claude-sonnet-5-5' "$T/2.log" || { cat "$T/2.log"; fail "case 2: wrong stop"; }
echo "case 2 ok: a saved task at another model stops the plan"

# case 3
go "$T/s" "$T/c" -- --go > "$T/3.log" 2>&1 || { cat "$T/3.log"; fail "case 3 exited non-zero"; }
[ "$(wc -l < "$T/c/runs/calls.log")" = 8 ] || fail "case 3: not 8 bench calls"
L=$(head -n 1 "$T/c/runs/calls.log")
for want in "--arms cc-konductor-team=$KSHA " '--replicates 2 --parallel 1' '--seed 20261121' \
  '--model us.anthropic.claude-sonnet-5-5 --effort high --run-budget-usd 1' '--budget-usd 2.00' "--out $T/c/runs/t8-dec-deploy-strategy"; do
  case "$L" in *"$want"*) ;; *) fail "case 3: first call lacks '$want': $L" ;; esac
done
case "$L" in *cc-vanilla*) fail "case 3: cc-vanilla ran" ;; esac
grep -q 'all tasks done, spent USD 8.00 of 16' "$T/3.log" || { cat "$T/3.log"; fail "case 3: spend line"; }
go "$T/s" "$T/c" -- --go > "$T/3r.log" 2>&1 || { cat "$T/3r.log"; fail "case 3 rerun exited non-zero"; }
[ "$(wc -l < "$T/c/runs/calls.log")" = 8 ] || fail "case 3: the rerun made a bench call"
echo "case 3 ok: new arm only, USD 1 a run, budget 2.00 a task, resumable"

# case 4
sleep 987.75 & SP=$!
if go "$T/s" "$T/d" BUSY_PAT='sleep 987[.]75' -- --go > "$T/4.log" 2>&1; then kill "$SP"; fail "case 4 should stop"; fi
kill "$SP"
grep -q 'another paid owner job is running' "$T/4.log" || { cat "$T/4.log"; fail "case 4: wrong stop"; }
[ ! -e "$T/d/runs/calls.log" ] || fail "case 4: a bench call"
echo "case 4 ok: no paid run beside another paid job"

# case 5
go "$T/s" "$T/c" -- --judge-plan > "$T/5.log" 2>&1 || { cat "$T/5.log"; fail "case 5 plan exited non-zero"; }
go "$T/s" "$T/c" -- --judge > "$T/5b.log" 2>&1 || { cat "$T/5b.log"; fail "case 5 exited non-zero"; }
grep -q "^judge --plan ROOT=$T/c CAP_USD=1 " "$T/stub.log" || { cat "$T/stub.log"; fail "case 5: judge plan call"; }
grep -q "^judge  ROOT=$T/c CAP_USD=1 REPORT=$KONDUCTOR_WS/reports/next-experiment-2026-11-22/judge-cc-team/report " "$T/stub.log" || { cat "$T/stub.log"; fail "case 5: judge call"; }
grep -q "ALSO=$T/s/judge/runs/t8-dec-deploy-strategy,.*$T/s/judge/runs/t1-nfr-report-queries$" "$T/stub.log" || { cat "$T/stub.log"; fail "case 5: study copies not added"; }
echo "case 5 ok: judge on the team root, cap USD 1, own report, study copies added"

# case 6
go "$T/s" "$T/c" -- --rescore > "$T/6.log" 2>&1 || { cat "$T/6.log"; fail "case 6 exited non-zero"; }
grep -q "^rescore CC_RUNS=$T/c/runs CC_ARMS=cc-konductor-team DEST=$KONDUCTOR_WS/reports/next-experiment-2026-11-22/cc-team-scores-newest-keys.tsv FIXED=$T/keys/bench SCRATCH=$T/c/rescore" "$T/stub.log" \
  || { cat "$T/stub.log"; fail "case 6: rescore call"; }
echo "case 6 ok: re-score of the team runs only, newest keys"

# case 7
go "$T/s" "$T/e" -- --loads > "$T/7.log" 2>&1 || { cat "$T/7.log"; fail "case 7 exited non-zero"; }
grep -q 'team arm: no runs yet' "$T/7.log" || { cat "$T/7.log"; fail "case 7: no 'no runs yet'"; }
echo "case 7 ok: loads with no runs"
echo "all cc-team cases passed"
