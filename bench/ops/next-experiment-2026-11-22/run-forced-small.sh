#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Focused follow-up of run-forced-aa-r2.sh (Fable review 2026-11-23, section 7): konductor-forced (same prefixes) and
# vanilla on t1-nfr-report-queries and t5-qa-checkout-strategy, 6 more replicates per arm per task, numbered 7 to 12
# so they never collide with replicates 1-3 (LITE) and 4-6 (the forced run). 24 runs, hard cap 150 credits. Same
# frozen bench, konductor ref, kiro-cli, model, effort, engine, seed, isolation and per-run limits as run-forced-aa-r2.sh.
# Tasks with runs-small/<task>.done are skipped, so a rerun resumes.
#
#   sh run-forced-small.sh          dry run: each task's budget, assuming every task spends its worst case
#   sh run-forced-small.sh --go     PAID run (needs approval: cap 150 credits). Waits for any run-forced-aa*/run-nudge run.
#
# Test hooks: STUB=<cmd> replaces the paid bench command and skips the user-namespace check; HERE=<dir> points at a
# copy of this folder; WAIT_PAT=<pattern> is the process pattern of the runs to wait for; LOAD_MAX=<n> is the load a
# task waits under (default 4); HEAVY_LOCK=<file> is the heavy lock a task waits for.
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203      # plan.json benchSha of reports/lite-run-2026-11-21
KONDUCTOR_SHA=f5d184596378ae72ae531d80647548512c14cacf  # plan.json konductorSha
R=$WS/worktrees/lite-frozen-69149846                    # read only; never worktrees/pilot
HERE=${HERE:-$WS/reports/next-experiment-2026-11-22}
OUT=$HERE/runs-small
KBIN=/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli
KBIN_PIN=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CACHE=/var/tmp/lite-konductor-cache
PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
GO=${1:-}
STUB=${STUB:-}
WAIT_PAT=${WAIT_PAT:-run-forced-aa|run-nudge[.]sh|run-pilot-(author|run)[.]sh}   # the kp pilot wrappers also hold the heavy lock while they spend
LOAD_MAX=${LOAD_MAX:-4}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
CAP=150
REPS=6
OFFSET=6                                                 # replicates 7..12
stop() { echo "stop: $*" >&2; exit 1; }

# task batch runLimit budget (runLimit is the LITE batch's per-run cap; budget covers 6 forced + 6 vanilla runs;
# the review's estimate is about 60 and 63 credits)
TASKS='t1-nfr-report-queries t1 23 75
t5-qa-checkout-strategy t5 23 75'

[ -e "$R" ] || stop "$R is missing (run-forced-aa-r2.sh creates it)"
[ "$(git -C "$R" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$R is not at $BENCH_SHA"
[ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes"
[ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_PIN" ] || stop "$KBIN is not the pinned kiro-cli 3.5.0"
[ -n "$PY312" ] || stop "no python 3.12"
if [ "$GO" = --go ] && [ -z "$STUB" ]; then
  unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them): run from your own terminal"
fi

# The prefix must be the one the forced run used: its sha256 in prefixes/manifest.json.
check_prefix() {
  task=$1; pre=$HERE/prefixes/$task.txt; want=''; got=''
  [ -s "$pre" ] || stop "missing $pre"
  want=$(node -e 'console.log(require(process.argv[1]).tasks[process.argv[2]].sha256)' "$HERE/prefixes/manifest.json" "$task")
  got=$(sha256sum "$pre" | cut -d' ' -f1)
  [ "$got" = "$want" ] || stop "$pre hashes to $got, manifest says $want"
}

spent_all() {
  node -e 'const {readLedger}=require(process.argv[1]); const fs=require("fs"), p=require("path"); const d=process.argv[2];
    let s=0; for (const t of fs.existsSync(d)?fs.readdirSync(d):[]) if (!t.endsWith(".done")) s+=readLedger(p.join(d,t)).totals.total; console.log(s.toFixed(2))' \
    "$R/bench/runner/lib/credit-ledger.js" "$OUT"
}

# Budget for one task, as in run-forced-aa-r2.sh: a command can spend up to 0.9 x budget + one run's limit. The budget
# is max(own budget, limit), cut so that spent + 0.9 x budget + limit <= CAP. Prints STOP when even one run would not fit.
budget_for() {
  bs=$1; bl=$2; bb=$3
  awk -v s="$bs" -v c="$CAP" -v l="$bl" -v b="$bb" 'BEGIN { if (b < l) b = l; m = (c - s - l) / 0.9; if (m < b) b = m;
    if (b < l) print "STOP"; else printf "%d", b }'
}
worst_case() { awk -v s="$1" -v b="$2" -v l="$3" 'BEGIN { printf "%.2f", s + 0.9 * b + l }'; }

# Wait (up to 24 h) until no other paid run of this experiment is running.
wait_others() {
  i=0; pids=''
  while :; do
    pids=$(pgrep -f "$WAIT_PAT" | grep -v "^$$\$" || true)
    [ -z "$pids" ] && return 0
    [ "$GO" = --go ] || { echo "another run is still running (pid $pids); --go waits for it"; return 0; }
    [ "$i" = 0 ] && echo "[$(date -u +%H:%M)] waiting for pid $pids"
    i=$((i + 1)); [ "$i" -le 288 ] || stop "still running after 24 h: $pids"
    sleep 300
  done
}

# Wait (up to 60 min) for load under LOAD_MAX and a free heavy lock before a task starts.
wait_host() {
  i=0; l=''
  while :; do
    l=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l" -v m="$LOAD_MAX" 'BEGIN { exit !(l < m) }' && flock -n "$HEAVY_LOCK" true; then return 0; fi
    i=$((i + 1)); [ "$i" -le 60 ] || stop "load $l or heavy lock busy for 60 min"
    sleep 60
  done
}

# Runs (or with no --go, prints) one task. Args: task batch limit budget. Dry-run spend is the running worst case.
run_task() {
  task=$1; batch=$2; limit=$3; budget=$4; pre=$HERE/prefixes/$1.txt; s=0; after=0
  check_prefix "$task"
  [ -e "$OUT/$task.done" ] && { echo "$task: done, skipped"; return 0; }
  [ -e "$OUT/$task" ] && stop "$OUT/$task exists without .done: check it by hand before a rerun"
  if [ "$GO" = --go ]; then wait_host; s=$(spent_all); else s=$DRY_SPENT; fi
  budget=$(budget_for "$s" "$limit" "$budget")
  [ "$budget" = STOP ] && stop "spent $s of $CAP: $task cannot fit one run of $limit"
  after=$(worst_case "$s" "$budget" "$limit")
  if [ "$GO" = --go ]; then echo "[$(date -u +%H:%M)] $task: spent $s of $CAP, budget $budget, limit $limit, worst case after $after"
  else printf '| %s | %s | %s | %s | %s |\n' "$task" "$limit" "$budget" "$s" "$after"; fi
  set -- node "$R/bench/runner/bench.js" run --suite pilot --tasks "$task" \
    --arms "vanilla,konductor-forced=$KONDUCTOR_SHA" --arm-prefix "konductor-forced=$pre" \
    --replicates "$REPS" --replicate-offset "$OFFSET" --parallel 1 --extra-tasks "$R/bench/scenarios/$batch" --repo-root "$R" --hide "$R" \
    --isolate unshare --seed 20261121 --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" \
    --python "$PY312" --cache "$CACHE" --budget-credits "$budget" --run-credit-limit "$limit" --out "$OUT/$task"
  if [ "$GO" = --go ]; then
    mkdir -p "$OUT"
    # </dev/null: the task list is on this loop's stdin, and the command must not read it.
    if [ -n "$STUB" ]; then $STUB "$@" </dev/null || stop "$task stub exited $?"
    else nice -n 10 "$@" </dev/null || stop "$task exited $?"; fi
    touch "$OUT/$task.done"
  else
    DRY_LAST="$*"
    DRY_SPENT=$after
  fi
}

wait_others
DRY_SPENT=$(spent_all)
DRY_LAST=''
[ "$GO" = --go ] || { echo '| task | run limit | budget | spent before (worst case) | worst case after |'; echo '| --- | --- | --- | --- | --- |'; }
# Not a pipe: the loop must run in this shell so DRY_SPENT carries from task to task.
while read -r t b l bud; do run_task "$t" "$b" "$l" "$bud"; done <<EOF
$TASKS
EOF
if [ "$GO" = --go ]; then echo "[$(date -u +%H:%M)] all tasks done, spent $(spent_all) of $CAP"
else echo; echo "worst case total: $DRY_SPENT of $CAP credits"; echo "last command: $DRY_LAST"; fi
