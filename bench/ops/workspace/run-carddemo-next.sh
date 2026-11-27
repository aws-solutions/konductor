#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# run-carddemo-next.sh: the owner's next two paid CardDemo steps, in order, in one command.
#   1. refresh the ops launchers to the bench head (free)
#   2. wait until the host load is under 4 (at most WAIT_MIN minutes, default 45)
#   3. the non-Claude recheck of cx-carddemo-batchday: total cap 397 counted (147.4 spent + 250 new), --call-worst 190
#   4. only if step 3 exits 0: CardDemo batchday step 1, soft per-run cap, 600 total, no judging
# Stops at the first failure. Owner terminal only (paid steps 3 and 4).
set -euo pipefail

WS=${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}
OPS=$WS/worktrees/ops
WAIT_MIN=${WAIT_MIN:-45}
say() { printf '[%s] %s\n' "$(date -u +%H:%M)" "$*"; }

say "step 1: refresh launchers"
git -C "$OPS" fetch -q origin feat/bench-pilot-nk
git -C "$OPS" checkout -q --detach FETCH_HEAD
bash "$OPS/bench/ops/make-launchers.sh" "$WS" --replace
grep -q -- '--call-worst' "$OPS/bench/ops/workspace/debt-paid/run.sh" \
  || { say "STOP: the ops checkout has no --call-worst guard; tell mate"; exit 1; }
say "launchers at $(git -C "$OPS" rev-parse --short HEAD)"

say "step 2: wait for load under 4 (up to $WAIT_MIN min)"
for ((i = 0; i < WAIT_MIN; i++)); do
  load=$(cut -d' ' -f1 /proc/loadavg)
  awk -v l="$load" 'BEGIN { exit !(l < 4) }' && break
  say "load $load, waiting"
  sleep 60
done
awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN { exit !(l < 4) }' \
  || { say "STOP: load still 4 or more after $WAIT_MIN min; rerun later"; exit 1; }

say "step 3: recheck (cap 397 counted, call worst 190)"
bash "$WS/scripts/run-debt-d275-cx-recheck.sh" --go --cap 397 --call-worst 190

say "step 4: CardDemo batchday step 1 (soft, 600 total)"
bash /var/tmp/konductor-cx-1h/run-cx.sh go cx-carddemo-batchday --soft --per-run-cap 270 --total-cap 600 \
  --stop-after-step 1 --judge-cap 0

say "done: tell mate"
