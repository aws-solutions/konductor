#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Resume of run-forced-aa.sh (same arms, tasks, pins and 450-credit cap). Fix: a task's budget is now max(its own budget,
# its per-run limit), still cut by the cap guard, so t6 (limit 68 > budget 65) no longer stops the wave with credits left.
# Tasks with runs/<task>.done are skipped.
#
#   sh run-forced-aa-r2.sh          dry run: prints each remaining task's budget, assuming every task spends its worst case
#   sh run-forced-aa-r2.sh --go     PAID run (approved: cap 450 credits)
#
# Test hooks: STUB=<cmd> replaces the paid bench command (the rest of the --go path runs as is) and also skips the
# user-namespace check; HERE=<dir> points at a copy of this folder.
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
REPO=$WS/worktrees/konductor-plant
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203      # plan.json benchSha of reports/lite-run-2026-11-21
KONDUCTOR_SHA=f5d184596378ae72ae531d80647548512c14cacf  # plan.json konductorSha (the reused konductor arm)
R=$WS/worktrees/lite-frozen-69149846                    # never worktrees/pilot
HERE=${HERE:-$WS/reports/next-experiment-2026-11-22}
KBIN=/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli
KBIN_PIN=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CACHE=/var/tmp/lite-konductor-cache
PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
GO=${1:-}
STUB=${STUB:-}
CAP=450
stop() { echo "stop: $*" >&2; exit 1; }

# task batch runLimit budget (runLimit is the LITE batch's per-run cap; budget covers 3 forced + 3 vanilla runs)
TASKS='t8-dec-deploy-strategy t8 23 55
t5-qa-checkout-strategy t5 23 55
t5-qa-sync-strategy t5 23 55
t6-req-field-inspections t6 68 65
t2-dr-notify-fanout t2 23 55
t2-arch-dr-split-checkout t2 23 55
t7-program-brief t7 15 55
t1-nfr-report-queries t1 23 55'

if [ -e "$R" ]; then
  [ "$(git -C "$R" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$R is not at $BENCH_SHA"
  [ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes"
elif [ "$GO" = --go ]; then
  git -C "$REPO" worktree add --detach "$R" "$BENCH_SHA"
fi
[ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_PIN" ] || stop "$KBIN is not the pinned kiro-cli 3.5.0"
[ -n "$PY312" ] || stop "no python 3.12"
if [ "$GO" = --go ] && [ -z "$STUB" ]; then
  unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them): run from your own terminal"
fi

spent_all() {
  node -e 'const {readLedger}=require(process.argv[1]); const fs=require("fs"), p=require("path"); const d=process.argv[2];
    let s=0; for (const t of fs.existsSync(d)?fs.readdirSync(d):[]) if (!t.endsWith(".done")) s+=readLedger(p.join(d,t)).totals.total; console.log(s.toFixed(2))' \
    "$R/bench/runner/lib/credit-ledger.js" "$HERE/runs"
}

# Budget for one task. The frozen runner starts a run while a command is under 90% of --budget-credits, so a command
# can spend up to 0.9 x budget + one run's limit. The budget is max(own budget, limit), then cut so that
# spent + 0.9 x budget + limit <= CAP. Prints STOP when even one run would not fit.
budget_for() {
  bs=$1; bl=$2; bb=$3
  awk -v s="$bs" -v c="$CAP" -v l="$bl" -v b="$bb" 'BEGIN { if (b < l) b = l; m = (c - s - l) / 0.9; if (m < b) b = m;
    if (b < l) print "STOP"; else printf "%d", b }'
}
worst_case() { awk -v s="$1" -v b="$2" -v l="$3" 'BEGIN { printf "%.2f", s + 0.9 * b + l }'; }

# Wait (up to 60 min) for load under 4 and a free heavy lock before a task starts.
wait_host() {
  i=0
  while :; do
    l=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l" 'BEGIN { exit !(l < 4) }' && flock -n /var/tmp/konductor-heavy.lock true; then return 0; fi
    i=$((i + 1)); [ "$i" -le 60 ] || stop "load $l or heavy lock busy for 60 min"
    sleep 60
  done
}

# Runs (or with no --go, prints) one task. Args: task batch limit budget. Dry-run spend is the running worst case.
run_task() {
  task=$1; batch=$2; limit=$3; budget=$4; pre=$HERE/prefixes/$task.txt; s=0
  [ -s "$pre" ] || stop "missing $pre"
  [ -e "$HERE/runs/$task.done" ] && { echo "$task: done, skipped"; return 0; }
  [ -e "$HERE/runs/$task" ] && stop "$HERE/runs/$task exists without .done: check it by hand before a rerun"
  if [ "$GO" = --go ]; then wait_host; s=$(spent_all); else s=$DRY_SPENT; fi
  budget=$(budget_for "$s" "$limit" "$budget")
  [ "$budget" = STOP ] && stop "spent $s of $CAP: $task cannot fit one run of $limit"
  echo "[$(date -u +%H:%M)] $task: spent $s of $CAP, budget $budget, limit $limit, worst case after $(worst_case "$s" "$budget" "$limit")"
  set -- node "$R/bench/runner/bench.js" run --suite pilot --tasks "$task" \
    --arms "vanilla,konductor-forced=$KONDUCTOR_SHA" --arm-prefix "konductor-forced=$pre" \
    --replicates 3 --replicate-offset 3 --parallel 1 --extra-tasks "$R/bench/scenarios/$batch" --repo-root "$R" --hide "$R" \
    --isolate unshare --seed 20261121 --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" \
    --python "$PY312" --cache "$CACHE" --budget-credits "$budget" --run-credit-limit "$limit" --out "$HERE/runs/$task"
  if [ "$GO" = --go ]; then
    mkdir -p "$HERE/runs"
    # </dev/null: the task list is on this loop's stdin, and the command must not read it.
    if [ -n "$STUB" ]; then $STUB "$@" </dev/null || stop "$task stub exited $?"
    else nice -n 10 "$@" </dev/null || stop "$task exited $?"; fi
    touch "$HERE/runs/$task.done"
  else
    echo "  $*"
    DRY_SPENT=$(worst_case "$s" "$budget" "$limit")
  fi
}

DRY_SPENT=$(spent_all)
# Not a pipe: the loop must run in this shell so DRY_SPENT carries from task to task.
while read -r t b l bud; do run_task "$t" "$b" "$l" "$bud"; done <<EOF
$TASKS
EOF
if [ "$GO" = --go ]; then echo "[$(date -u +%H:%M)] all tasks done, spent $(spent_all) of $CAP"; fi
