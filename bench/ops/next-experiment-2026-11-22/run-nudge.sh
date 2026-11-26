#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Nudge-arm run: konductor-list (design A, a userPromptSubmit hook printing every skill name, a pointer to the trigger
# lines, and "Check this list and load a matching skill before you start; say no skill fits if none does"; no matching,
# no request data) and konductor-filler (same hook shape, neutral text of the same size, no skill named), 3 runs each,
# on the same 8 tasks, frozen bench, konductor ref, kiro-cli, model and seed as run-forced-aa-r2.sh. Hard cap 450
# credits. Design B (the top-3 matcher) is not run: about half top-3 recall on held-out tasks.
# Tasks with runs-nudge/<task>.done are skipped, and a task folder without .done is run again with --resume (only
# its cells with no result or a budget skip), so a rerun resumes. A task with a cell still not run gets no .done.
# An errored run whose agent killed its own kiro-cli (cap nudge-check: "agent self-kill") is a run result: the runner's
# exit 5 for it does not stop the study. Any other error with exit 5 still stops.
#
#   sh run-nudge.sh          dry run: arm and host checks, then each task's budget assuming every task spends its worst case
#   sh run-nudge.sh --go     PAID run (approved: cap 450 credits). Waits for run-forced-aa*.sh to finish first.
#   sh run-nudge.sh --fill [--plan]   free plan of the fill stage (below): cells, budgets, worst case against its cap
#   sh run-nudge.sh --fill --go       PAID fill stage (approved 2026-11-23: cap 60 counted credits)
#
# Fill stage: the 450 cap left 3 cells budget skipped (t1-nfr-report-queries list and filler #3, t2-dr-notify-fanout
# list #3; nudge-fill.js names them). --fill resumes only those two task folders, t1 first, and never runs a cell that
# has a result. Its cap is 60 counted credits: each call of a stage cell counts at the larger of 15 and its credits,
# read from the task ledgers. Before each task the script refuses the call unless counted spend plus that task's worst
# case fits. One cell: budget = run limit, worst case one limit. Two cells: the frozen runner starts the second only
# when charged + largest run <= budget, so with budget B the first counts at most max(15, B/2) when the second starts;
# B = min(2 x limit, 2 x (cap - spent - limit)), worst case spent + max(15, B/2) + limit.
#
# The two arms are `cap variant --hook` trees built from git archive of the konductor ref (never a worktree), pinned
# by variant hash and hook command sha256 below. A missing arm is rebuilt with the same command (reproducible).
# After each task, `cap nudge-check` must see the hook text in every hook-arm run, or the script stops (DEBT D-169).
#
# Test hooks: STUB=<cmd> replaces the paid bench command and skips the user-namespace check; HERE=<dir> points at a
# copy of this folder; FORCED_PAT=<pattern> is the process pattern of the run to wait for; LOAD_MAX=<n> is the load
# a task waits under (default 4); HEAVY_LOCK=<file> is the heavy lock a task waits for (default /var/tmp/konductor-heavy.lock);
# CHECK_BENCH=<dir> is the checkout whose cap nudge-check runs (default: the one holding this script).
# NB=<dir> is the bench checkout that builds the arms (default: the nudge-nk worktree); it must contain NB_MIN.
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
REPO=$WS/worktrees/konductor-plant
NB=${NB:-$REPO/.worktrees/nudge-nk}                      # bench with cap variant --hook and cap nudge-check
NB_MIN=6e67dcf3                                          # NB must contain this commit (cap variant --hook list)
# cap nudge-check comes from the checkout holding this script (it knows a cell that never started); NB only builds arms.
CHECK_BENCH=${CHECK_BENCH:-$(cd "$(dirname "$0")/../../.." && pwd)}
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203       # frozen runner, as in run-forced-aa-r2.sh
KONDUCTOR_SHA=f5d184596378ae72ae531d80647548512c14cacf   # base of both hook arms (the LITE konductor ref)
R=$WS/worktrees/lite-frozen-69149846                     # read only; never worktrees/pilot
HERE=${HERE:-$WS/reports/next-experiment-2026-11-22}
OUT=$HERE/runs-nudge
ARMS=/var/tmp/konductor-nudge-arms
LIST=$ARMS/variants/konductor-list-4a05c9e54b9f
LIST_HASH=cef75db0b1b3c2bbe3f335606f29929f4a3009f53d69aafee54531b753ffb485
LIST_CMD=72a01fec4ddb020d4c4f3f09da1bed41c43dbec77af12a23a7ff2a8c071be507     # frozen list hook, 1,642 bytes of output
FILLER=$ARMS/variants/konductor-filler-023c8003eb5c
FILLER_HASH=52bd7ddab562bed39afebd1033fcb770def2e0cf0673246ea1bd5c7041d19163
FILLER_CMD=d63c0af48143057f83a3beb29b236575e06be19b2609adaf096caf2c90d57e8d
KBIN=/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli
KBIN_PIN=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CACHE=/var/tmp/lite-konductor-cache
PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
GO=${1:-}
FILL=0
if [ "$GO" = --fill ]; then FILL=1; GO=${2:-}; fi
[ "$GO" = --plan ] && GO=''
STUB=${STUB:-}
FORCED_PAT=${FORCED_PAT:-run-forced-aa}
LOAD_MAX=${LOAD_MAX:-4}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
CAP=450
FILL_JS=$CHECK_BENCH/bench/ops/next-experiment-2026-11-22/nudge-fill.js
FILL_MIN=15
spent_all() { ledger_spent "$OUT"; }
stop() { echo "stop: $*" >&2; exit 1; }
. "$(dirname "$0")/lib.sh"   # shared spend and host helpers (D-242)

# task batch runLimit budget: the forced run's table (6 runs per task: 3 list + 3 filler, as there 3 forced + 3 vanilla)
TASKS='t8-dec-deploy-strategy t8 23 55
t5-qa-checkout-strategy t5 23 55
t5-qa-sync-strategy t5 23 55
t6-req-field-inspections t6 68 65
t2-dr-notify-fanout t2 23 55
t2-arch-dr-split-checkout t2 23 55
t7-program-brief t7 15 55
t1-nfr-report-queries t1 23 55'
# The fill stage's tasks, in run order (t1 first: at worst case its 2 cells fit and close a whole task).
if [ "$FILL" = 1 ]; then
  CAP=60
  TASKS='t1-nfr-report-queries t1 23 23
t2-dr-notify-fanout t2 23 23'
fi

# Builds a missing arm (--go only), then checks it: variant hash, hook command sha, and the tree still hashing to it.
# Args: dir kind variantHash commandSha.
check_arm() {
  dir=$1; kind=$2; want=$3; cmd=$4; got=''
  if [ ! -e "$dir/variant.json" ]; then
    [ "$GO" = --go ] || { echo "arm $kind: not built yet (--go builds it)"; return 0; }
    TMPDIR=/var/tmp node "$NB/bench/runner/bench.js" cap variant --repo-root "$REPO" --base "$KONDUCTOR_SHA" --hook "$kind" \
      --agent-engine v3 --scratch "$ARMS" >/dev/null || stop "cannot build the $kind arm"
  fi
  got=$(node -e 'const v=require(process.argv[1]); const h=v.ops.find((o)=>o.op==="hook"); console.log(v.variantHash+" "+(h?h.commandSha256:"-"))' "$dir/variant.json")
  [ "$got" = "$want $cmd" ] || stop "arm $kind: variant.json says $got, pinned $want $cmd"
  got=$(node -e 'console.log(require(process.argv[1]).snapshotDir(process.argv[2]).hash)' "$NB/bench/runner/lib/arm-source.js" "$dir/tree")
  [ "$got" = "$want" ] || stop "arm $kind: tree hashes to $got, not $want (it changed after the build)"
  echo "arm $kind: ok ($dir)"
}

git -C "$NB" merge-base --is-ancestor "$NB_MIN" HEAD 2>/dev/null || stop "$NB does not contain $NB_MIN (cap variant --hook)"
if [ -e "$R" ]; then
  [ "$(git -C "$R" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$R is not at $BENCH_SHA"
  [ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes"
else
  stop "$R is missing: run-forced-aa-r2.sh creates it"
fi
[ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_PIN" ] || stop "$KBIN is not the pinned kiro-cli 3.5.0"
[ -n "$PY312" ] || stop "no python 3.12"
check_arm "$LIST" list "$LIST_HASH" "$LIST_CMD"
check_arm "$FILLER" filler "$FILLER_HASH" "$FILLER_CMD"
if [ "$GO" = --go ] && [ -z "$STUB" ]; then
  unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them): run from your own terminal"
fi

# Credits the forced run spent on one task (the nearest real figure for 6 runs of that task), for the dry-run table.
forced_spent() {
  node -e 'const {readLedger}=require(process.argv[1]); const fs=require("fs"); const d=process.argv[2];
    console.log(fs.existsSync(d) ? readLedger(d).totals.total.toFixed(2) : "-")' "$R/bench/runner/lib/credit-ledger.js" "$HERE/runs/$1"
}

# Fill stage: counted spend of the stage cells, and one task's "budget worstCaseAfter" (STOP when it does not fit).
# Args of fill_budget: counted spend, cells to run, run limit. See the top of this file for the rule.
fill_spent() { node "$FILL_JS" spent "$OUT" 23; }
fill_budget() {
  awk -v s="$1" -v n="$2" -v l="$3" -v c="$CAP" -v m="$FILL_MIN" 'BEGIN { w = (l > m) ? l : m;
    if (n == 1) { if (s + w > c) print "STOP"; else printf "%d %.2f", l, s + w; exit }
    left = c - s - w; if (n != 2 || left < m) { print "STOP"; exit }
    b = 2 * left; if (b > 2 * l) b = 2 * l; b = int(b); h = (b / 2 > m) ? b / 2 : m; printf "%d %.2f", b, s + h + w }'
}

# The forced run shares the host and the cache: wait (up to 24 h) until no run-forced-aa*.sh is running.
wait_forced() {
  i=0; pids=''
  while :; do
    pids=$(pgrep -f "$FORCED_PAT" | grep -v "^$$\$" || true)
    [ -z "$pids" ] && return 0
    [ "$GO" = --go ] || { echo "forced run: still running (pid $pids); --go waits for it"; return 0; }
    [ "$i" = 0 ] && echo "[$(date -u +%H:%M)] waiting for the forced run (pid $pids)"
    i=$((i + 1)); [ "$i" -le 288 ] || stop "the forced run is still running after 24 h"
    sleep 300
  done
}

# Runs (or with no --go, prints) one task. Args: task batch limit budget. Dry-run spend is the running worst case.
run_task() {
  task=$1; batch=$2; limit=$3; budget=$4; s=0; after=0; fs=''; rc=0; nocall=0
  [ -e "$OUT/$task.done" ] && { echo "$task: done, skipped"; return 0; }
  # A task folder without .done was cut short (budget skip, crash): --resume runs only its cells with no result.json or
  # a budget_skipped one, and keeps the rest, errors included.
  resume=''
  [ -e "$OUT/$task" ] && { resume=--resume; echo "$task: folder without .done, resuming its unfinished cells"; }
  # Every one of the 6 cells already has a started result (a stop after the last run, as an exit 5): nothing to resume,
  # so no bench call; the check below still decides .done.
  if [ -n "$resume" ] && [ "$GO" = --go ]; then
    node "$CHECK_BENCH/bench/runner/bench.js" cap nudge-check --run "$OUT/$task" > "$OUT/$task.check.md" || true
    if [ "$(grep -c '^| konductor-' "$OUT/$task.check.md")" = 6 ] && ! grep -q '| not run (' "$OUT/$task.check.md"; then
      echo "$task: all 6 cells have a result, no bench call"; rc=5; nocall=1
    fi
  fi
  # Fill stage: only an existing task folder, and only its stage cells (nudge-fill.js stops on any other missing cell).
  n=0
  if [ "$FILL" = 1 ]; then
    [ -n "$resume" ] || stop "$OUT/$task is missing: the fill stage only resumes a task folder"
    cells=$(node "$FILL_JS" missing "$OUT" "$task") || stop "$task: a cell outside the fill stage has no result"
    n=$(printf '%s\n' "$cells" | grep -c . || true)
    echo "$task: $n fill cell(s) to run: $(printf '%s' "$cells" | tr '\n' ',' )"
  fi
  if [ "$GO" = --go ]; then
    wait_host
    if [ "$FILL" = 1 ]; then s=$(fill_spent); else s=$(spent_all); fi
  else s=$DRY_SPENT; fi
  if [ "$FILL" = 1 ]; then
    fb=$(fill_budget "$s" "$n" "$limit"); budget=${fb%% *}; after=${fb#* }
    [ "$n" = 0 ] && { budget=$limit; after=$s; }
  else budget=$(budget_for "$s" "$limit" "$budget"); fi
  if [ "$budget" = STOP ]; then
    [ "$GO" = --go ] && [ "$FILL" = 1 ] && stop "counted $s of $CAP: $task does not fit ($n cell(s), worst case $limit each); it stays without .done"
    [ "$GO" = --go ] && stop "spent $s of $CAP: $task cannot fit one run of $limit"
    # Dry run: this task runs only if the tasks before it spend less than their worst case, which they do in practice.
    if [ "$FILL" = 1 ]; then
      printf '| %s | %s | %s | cut | %s | not reached at worst case |\n' "$task" "$n" "$limit" "$s"
      DRY_CUT="$DRY_CUT $task (runs only if counted spend before it is at most $(awk -v c="$CAP" -v l="$limit" -v m="$FILL_MIN" 'BEGIN { print c - (l > m ? l : m) }'))"
      DRY_EXPECTED=$((DRY_EXPECTED + n * FILL_MIN))
    else printf '| %s | %s | cut | %s | not reached at worst case | %s |\n' "$task" "$limit" "$s" "$(forced_spent "$task")"; fi
    return 0
  fi
  [ "$FILL" = 1 ] || after=$(worst_case "$s" "$budget" "$limit")
  if [ "$GO" = --go ]; then echo "[$(date -u +%H:%M)] $task: spent $s of $CAP, budget $budget, limit $limit, worst case after $after"
  elif [ "$FILL" = 1 ]; then
    printf '| %s | %s | %s | %s | %s | %s |\n' "$task" "$n" "$limit" "$budget" "$s" "$after"
    DRY_EXPECTED=$((DRY_EXPECTED + n * FILL_MIN))
  else printf '| %s | %s | %s | %s | %s | %s |\n' "$task" "$limit" "$budget" "$s" "$after" "$(forced_spent "$task")"; fi
  set -- node "$R/bench/runner/bench.js" run --suite pilot --tasks "$task" \
    --arms "konductor-list=dir:$LIST/tree,konductor-filler=dir:$FILLER/tree" \
    --replicates 3 --parallel 1 --extra-tasks "$R/bench/scenarios/$batch" --repo-root "$R" --hide "$R" \
    --isolate unshare --seed 20261121 --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" \
    --python "$PY312" --cache "$CACHE" --budget-credits "$budget" --run-credit-limit "$limit" --out "$OUT/$task" $resume
  if [ "$GO" = --go ]; then
    mkdir -p "$OUT"
    # </dev/null: the task list is on this loop's stdin, and the command must not read it.
    if [ "$nocall" = 1 ]; then :
    elif [ -n "$STUB" ]; then $STUB "$@" </dev/null || rc=$?
    else nice -n 10 "$@" </dev/null || rc=$?; fi
    # Exit 5 is the runner's infra stop (every run of the command errored). It passes only when the check below shows
    # every error is an agent self-kill: the agent's own act, kept as a run result. Any other exit stops here.
    [ "$rc" = 0 ] || [ "$rc" = 5 ] || stop "$task exited $rc"
    [ "$rc" = 0 ] || [ -d "$OUT/$task" ] || stop "$task exited $rc"
    # The treatment check: every hook-arm run must show its hook text (exit 1 otherwise). No .done until it passes.
    # A cell that never started is "not run", not a hook miss; it leaves the task without .done, so a rerun resumes it.
    if [ -d "$OUT/$task" ]; then
      node "$CHECK_BENCH/bench/runner/bench.js" cap nudge-check --run "$OUT/$task" > "$OUT/$task.check.md" \
        || stop "$task: a hook arm ran without its hook text (see $OUT/$task.check.md); fix before the next task"
      if [ "$rc" = 5 ]; then
        grep -q '| error |' "$OUT/$task.check.md" && stop "$task exited 5 with an error that is not an agent self-kill (see $OUT/$task.check.md)"
        echo "[$(date -u +%H:%M)] $task: runner exit 5, but every error is an agent self-kill (a run result); going on"
      fi
      if grep -q '| not run (' "$OUT/$task.check.md"; then
        echo "[$(date -u +%H:%M)] $task: $(grep -c '| not run (' "$OUT/$task.check.md") cell(s) not run; no .done, a rerun resumes them"
        return 0
      fi
    fi
    touch "$OUT/$task.done"
  else
    DRY_LAST="$*"
    DRY_SPENT=$after
  fi
}

wait_forced
if [ "$FILL" = 1 ]; then DRY_SPENT=$(fill_spent); else DRY_SPENT=$(spent_all); fi
DRY_LAST=''
DRY_CUT=''
DRY_EXPECTED=0
if [ "$GO" != --go ] && [ "$FILL" = 1 ]; then
  echo; echo "fill stage, cap $CAP counted credits (each call at the larger of $FILL_MIN and its credits)"
  echo '| task | cells | run limit | budget | counted before (worst case) | worst case after |'; echo '| --- | --- | --- | --- | --- | --- |'
elif [ "$GO" != --go ]; then
  echo; echo '| task | run limit | budget | spent before (worst case) | worst case after | forced run spent |'; echo '| --- | --- | --- | --- | --- | --- |'
fi
# Not a pipe: the loop must run in this shell so DRY_SPENT carries from task to task.
while read -r t b l bud; do run_task "$t" "$b" "$l" "$bud"; done <<EOF
$TASKS
EOF
if [ "$GO" = --go ] && [ "$FILL" = 1 ]; then echo "[$(date -u +%H:%M)] fill stage done, counted $(fill_spent) of $CAP"
elif [ "$GO" = --go ]; then echo "[$(date -u +%H:%M)] all tasks done, spent $(spent_all) of $CAP"
else
  echo; echo "worst case total: $DRY_SPENT of $CAP credits"
  if [ "$FILL" = 1 ]; then
    echo "cut at worst case:${DRY_CUT:- none}"
    echo "expected: $DRY_EXPECTED.00 of $CAP counted credits (every run at $FILL_MIN; the 9 runs of these two tasks so far cost 6.8 to 14.8)"
    echo "not in the worst case: a throttle retry (at most one per cell, each counted at least $FILL_MIN) and a run that overshoots its limit"
  fi
  echo "last command: $DRY_LAST"
fi
