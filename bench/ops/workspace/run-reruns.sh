#!/usr/bin/env bash
# One command for the owner terminal: reruns of the pilot waves whose keys changed.
#   1. waits (up to 90 min) for chat-76's edited-task list, then for any running wave to end
#   2. moves the pilot pin to the newest feat/bench-pilot-nk head
#   3. runs wave 4 (T3), 7 (T7), 8 (T8), then the three fixed T11/T12 tasks, one after another
# Old outputs are kept: every rerun writes to /tmp/pilot-wN-rerun.* . A failed wave does not stop the rest.
# Expected spend: about 140 credits (pilot total then about 716 of 725 soft cap).
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
PILOT=$WS/worktrees/pilot
WAVE=$PILOT/bench/scripts/pilot-wave.sh
EDITED=$WS/reports/tasks-edited-wave11-12.md
. "$(dirname "$0")/../lib.sh"   # say, stop and fail (B-005)

say "waiting for the edited-task list (up to 90 min)"
for _ in $(seq 1 180); do
  [ -s "$EDITED" ] && break
  sleep 30
done
[ -s "$EDITED" ] && say "edited-task list found" || say "no list yet: going on with the newest head anyway"

say "waiting for any running wave to end"
while pgrep -f 'pilot-wave.sh' >/dev/null; do sleep 30; done

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

run_wave pilot-w4-rerun 4
run_wave pilot-w7-rerun 7
run_wave pilot-w8-rerun 8
run_wave pilot-w11-rerun 11 --tasks t11-merge-pricing-branches,t11-fresh-session-memory
run_wave pilot-w12-rerun 12 --tasks t12-spec-rate-limits
say "all done"
