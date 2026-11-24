#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# The forced-skills experiment's two new arms on the FROZEN LITE bench (69149846, task versions as run), so they compare
# with the 48 reused LITE runs. konductor-forced: the LITE konductor ref with a per-task forced-load prefix (prefixes/,
# built by forced-must-load.js from the frozen task JSONs; the frozen runner puts it in front of the prompt exactly as
# --forced-must-load would). vanilla A/A: vanilla again as replicates 4 to 6. The frozen runner has no D-161 no-git line.
#
# Prints the commands by default. `sh run-forced-aa.sh --go` runs them (PAID: 48 runs, cap 450 credits; approve first).
# It uses its own worktree and never touches worktrees/pilot.
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
REPO=$WS/worktrees/konductor-plant
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203      # plan.json benchSha of reports/lite-run-2026-11-21
KONDUCTOR_SHA=f5d184596378ae72ae531d80647548512c14cacf  # plan.json konductorSha (the reused konductor arm)
R=$WS/worktrees/lite-frozen-69149846                    # never worktrees/pilot
HERE=$WS/reports/next-experiment-2026-11-22
KBIN=/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli
KBIN_PIN=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CACHE=/var/tmp/lite-konductor-cache
PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
GO=${1:-}
spent_all() { ledger_spent "$HERE/runs"; }
stop() { echo "stop: $*" >&2; exit 1; }
. "$(dirname "$0")/lib.sh"   # shared spend and host helpers (D-242)

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
[ "$GO" != --go ] || unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them): run from your own terminal"

# Total cap. The frozen runner starts a run while a command is under 90% of its --budget-credits and checks nothing
# else, so one command can spend up to 0.9 x budget + one run's limit. Before each task the budget is cut so that
# spend so far plus that worst case stays within CAP. A task that cannot fit one run is not started.
CAP=450

echo "$TASKS" | while read -r task batch limit budget; do
  pre=$HERE/prefixes/$task.txt
  [ -s "$pre" ] || stop "missing $pre"
  if [ "$GO" = --go ]; then
    [ -e "$HERE/runs/$task.done" ] && { echo "$task: done, skipped"; continue; }
    [ -e "$HERE/runs/$task" ] && stop "$HERE/runs/$task exists without .done: check it by hand before a rerun"
    wait_host
    s=$(spent_all)
    budget=$(awk -v s="$s" -v c="$CAP" -v l="$limit" -v b="$budget" 'BEGIN { m = (c - s - l) / 0.9; if (m < b) b = m; if (b < l) print "STOP"; else printf "%d", b }')
    [ "$budget" = STOP ] && stop "spent $s of $CAP: $task cannot fit one run of $limit"
    echo "[$(date -u +%H:%M)] $task: spent $s of $CAP, budget $budget, load $(cut -d' ' -f1 /proc/loadavg)"
  fi
  set -- node "$R/bench/runner/bench.js" run --suite pilot --tasks "$task" \
    --arms "vanilla,konductor-forced=$KONDUCTOR_SHA" --arm-prefix "konductor-forced=$pre" \
    --replicates 3 --replicate-offset 3 --parallel 1 --extra-tasks "$R/bench/scenarios/$batch" --repo-root "$R" --hide "$R" \
    --isolate unshare --seed 20261121 --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" \
    --python "$PY312" --cache "$CACHE" --budget-credits "$budget" --run-credit-limit "$limit" --out "$HERE/runs/$task"
  if [ "$GO" = --go ]; then
    mkdir -p "$HERE/runs"
    nice -n 10 "$@" || stop "$task exited $?"
    touch "$HERE/runs/$task.done"
  else echo "$*"; fi
done
if [ "$GO" = --go ]; then echo "[$(date -u +%H:%M)] all tasks done, spent $(spent_all) of $CAP"; fi
