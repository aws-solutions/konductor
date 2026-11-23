#!/usr/bin/env bash
# Third unattended command. Start it in its own terminal; it waits for run-after-tonight.sh to end, then runs
#   1. run-wave0-fix.sh               fills the 7 skipped wave 0 runs, then the arm trial (USD 8 cap), then the wave 0 table
#   2. arm-signed-release-test-v2.sh     arm policy test + controls on the signed 12-task release (free, heavy)
#   3. run-namespace-test.sh          the one failing namespace test (D-165), full output to reports/ns-test-<ts>.log
# A failed step is logged and the next one still runs. Log: reports/overnight-morning-<time>.log
# Needs keep-creds-fresh.sh running in another terminal (step 1 makes paid calls).
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
S=$WS/scripts
LOG=$WS/reports/overnight-morning-$(date -u +%Y%m%d-%H%M).log
say() { echo "[$(date -u +%H:%M)] $*" | tee -a "$LOG"; }

say "waiting for run-after-tonight.sh to end (up to 12 h)"
for _ in $(seq 1 1440); do
  pgrep -f 'run-after-tonight.sh|run-tonight.sh' >/dev/null || break
  sleep 30
done
say "run-after-tonight.sh ended"

run_step() {   # run_step LABEL SCRIPT
  label=$1; script=$2
  if [ ! -f "$script" ]; then say "$label: $script not found, skipped"; return; fi
  say "$label: start"
  bash "$script" 2>&1 | tee -a "$LOG"
  say "$label: exit ${PIPESTATUS[0]}"
}

quiet() { for _ in $(seq 1 60); do l=$(cut -d' ' -f1 /proc/loadavg); awk -v l="$l" 'BEGIN{exit !(l<4)}' && return; sleep 30; done; }

quiet; run_step "1 wave 0 fix + arm trial" "$S/run-wave0-fix.sh"
quiet; run_step "2 arm signed release"     "$S/arm-signed-release-test-v2.sh"
quiet; run_step "3 namespace test"         "$S/run-namespace-test.sh"
say "morning queue done"
