#!/usr/bin/env bash
# Second unattended command for the night. Start it in its own terminal (or right after run-tonight.sh).
# It waits until run-tonight.sh (judge pass, then wave 0) has ended, then runs the free heavy jobs one by one:
#   1. regate-open-set.sh        full open-set re-gate for the Physical AI counted set (free, about 1 h)
#   2. arm-signed-release-test-v2.sh   arm policy test + controls on the owner-signed release (free)   [if the file exists]
#   3. run-full-suite-twice-v2.sh      two full bench suite runs with TMPDIR=/tmp (free)               [if the file exists]
# Nothing here spends credits. A failed step is logged and the next step still runs.
# Log: reports/overnight-after-<time>.log
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
S=$WS/scripts
LOG=$WS/reports/overnight-after-$(date -u +%Y%m%d-%H%M).log
say() { echo "[$(date -u +%H:%M)] $*" | tee -a "$LOG"; }

say "waiting for run-tonight.sh to end (up to 12 h)"
for _ in $(seq 1 1440); do
  pgrep -f 'run-tonight.sh|run-physical-ai-wave0.sh' >/dev/null || break
  sleep 30
done
say "run-tonight.sh ended; starting the free heavy jobs"

run_step() {   # run_step LABEL SCRIPT
  label=$1; script=$2
  if [ ! -f "$script" ]; then say "$label: $script not found, skipped"; return; fi
  say "$label: start"
  bash "$script" 2>&1 | tee -a "$LOG"
  say "$label: exit ${PIPESTATUS[0]}"
}

# wait for a quiet host before each step (load under 4), up to 30 min, then go on anyway
quiet() { for _ in $(seq 1 60); do l=$(cut -d' ' -f1 /proc/loadavg); awk -v l="$l" 'BEGIN{exit !(l<4)}' && return; sleep 30; done; }

quiet; run_step "1 re-gate"            "$S/regate-open-set.sh"
quiet; run_step "2 arm signed release" "$S/arm-signed-release-test-v2.sh"
quiet; run_step "3 full suite twice"   "$S/run-full-suite-twice-v2.sh"
say "all free heavy jobs done"
