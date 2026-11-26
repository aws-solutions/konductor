#!/usr/bin/env bash
# Second rerun batch: the three T11/T12 tasks fixed after the first batch started.
# Waits for run-reruns.sh and any wave to end, moves the pilot pin to the newest head, then runs
# wave 11 (2 tasks) and wave 12 (1 task). Expected spend: about 10 credits.
# Outputs: /tmp/pilot-w11-rerun2*, /tmp/pilot-w12-rerun2* (first-batch outputs stay).
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
PILOT=$WS/worktrees/pilot
WAVE=$PILOT/bench/scripts/pilot-wave.sh
. "$(dirname "$0")/../lib.sh"   # say, stop and fail (B-005)

say "waiting for run-reruns.sh and any wave to end"
while pgrep -f 'run-reruns.sh|pilot-wave.sh' >/dev/null; do sleep 30; done

say "moving the pilot pin"
git -C "$PILOT" fetch -q origin feat/bench-pilot-nk || { say "fetch failed: stopping"; exit 1; }
git -C "$PILOT" checkout -q --detach origin/feat/bench-pilot-nk || { say "checkout failed: stopping"; exit 1; }
say "pin at $(git -C "$PILOT" rev-parse --short HEAD)"

run_wave() {   # run_wave NAME WAVE [extra args]
  name=$1; w=$2; shift 2
  if [ -e "/tmp/$name" ]; then say "/tmp/$name exists: skipping $name"; return; fi
  say "starting $name"
  env -u R -u KBIN -u PY312 bash "$WAVE" "$w" --out "/tmp/$name" "$@"
  if [ -s "/tmp/$name-table.md" ]; then say "$name done: /tmp/$name-table.md"; else say "$name has no table: see /tmp/$name.log"; fi
}

run_wave pilot-w11-rerun2 11 --tasks t11-merge-pricing-branches,t11-docx-room-booking-reqs
run_wave pilot-w12-rerun2 12 --tasks t12-spec-rate-limits
say "all done"
