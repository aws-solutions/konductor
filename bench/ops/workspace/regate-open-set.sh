#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# regate-open-set.sh -- the FULL conveyor open-set re-gate (item 6) in ONE command, for the owner's terminal.
# It runs gate A (static lint of every open + held-back variant) and gate B (the four control suites on both arms,
# TWICE, compared) over the WHOLE open set, logs everything under reports/, and prints the paths. No model, no
# credits, no USD: gate B drives scripted controls only. It is the counted set's own tools/lint.js + tools/gate-v2.sh (toy key, one pass);
# this wrapper only adds a stable log folder and a quiet-host reminder.
#
#   bash scripts/regate-open-set.sh
#
# Run it on a QUIET host: gate B control suites stop when another process opens a TCP listener between trials and
# resume into the same out dir, so a busy host just makes it slow. ~210 open + held-back variants x 4 controls x 2
# arms x 2 runs is a few thousand short trials; budget a couple of hours of wall time at --parallel 1.
# Overrides: PLANT_CHECKOUT, PLANT_CS (the private counted-set folder), PLANT_VENV (a python 3.12 with cedarpy).
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

# Hard timeout: re-exec under `timeout` (TERM, then KILL 120s later) so a stuck gate can never hold the heavy lock
# forever. ~1-2 h of real work; default 180m. Keeps the same PID/fds, so a caller's flock on the heavy lock survives.
if [ -z "${REGATE_TIMED:-}" ]; then
  exec env REGATE_TIMED=1 timeout --signal=TERM --kill-after=120 "${REGATE_TIMEOUT:-180m}" bash "$0" "$@"
fi

CHECKOUT=${PLANT_CHECKOUT:-$KONDUCTOR_WS/worktrees/konductor-plant/.worktrees/phys-nk}
CS=${PLANT_CS:-$KONDUCTOR_WS/plant-counted-set}
VENV=${PLANT_VENV:-/home/$USER/.cache/konductor-arm/venv}
REPORTS=$KONDUCTOR_WS/reports
[ -f "$CHECKOUT/bench/runner/bench.js" ] || { echo "STOP: no bench at $CHECKOUT (set PLANT_CHECKOUT)" >&2; exit 1; }
[ -d "$CS/release/tasks" ] || { echo "STOP: no counted set at $CS (set PLANT_CS)" >&2; exit 1; }
[ -x "$VENV/bin/python" ] || { echo "STOP: no python3.12 venv at $VENV (set PLANT_VENV)" >&2; exit 1; }
TS=$(date -u +%Y%m%d-%H%M%S); LOGDIR="$REPORTS/regate-open-$TS"; mkdir -p "$LOGDIR"
# Belt-and-suspenders over gate.sh's own restore: back up the runner's pinned-keys.json and restore it on ANY exit
# (incl. TERM/timeout), so an interrupted gate never leaves a throwaway key pinned (gate.sh's EXIT trap misses a
# SIGKILL, and this wrapper's TERM trap fires before the timeout's follow-up KILL).
PINNED="$CHECKOUT/bench/runner/lib/plant/pinned-keys.json"
PIN_BAK="$LOGDIR/pinned-keys.backup.json"
if [ -f "$PINNED" ]; then
  cp -f "$PINNED" "$PIN_BAK"
  trap 'cp -f "$PIN_BAK" "$PINNED" 2>/dev/null || true' EXIT
  trap 'cp -f "$PIN_BAK" "$PINNED" 2>/dev/null || true; exit 143' TERM INT
fi
# The gate work dir (and the throwaway release it signs) MUST sit outside home, so /var/tmp, not under reports/
# (which is inside $HOME): bench refuses a plant release path inside home, scratch or the checkout.
WORK=${PLANT_WORK:-/var/tmp/regate-open-$TS}
say() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

say "gate A (lint) over the whole set -> $LOGDIR/gateA.log"
node "$CS/tools/lint.js" --bench "$CHECKOUT" > "$LOGDIR/gateA.log" 2>&1 && say "gate A: no problems" \
  || say "gate A: $(grep -c ': ' "$LOGDIR/gateA.log" 2>/dev/null || echo '?') line(s) flagged (see $LOGDIR/gateA.log; the p3/p4/p6 R2+R3 lines are the known D-94 relabel, not new)"

say "gate B (four controls, both arms, twice, compared) over the whole open set -> $LOGDIR/gateB.log"
nice -n 19 "$CS/tools/gate-v2.sh" --bench "$CHECKOUT" --plant-python "$VENV/bin/python" --work "$WORK" > "$LOGDIR/gateB.log" 2>&1 || true
say "gate B tail:"; tail -40 "$LOGDIR/gateB.log"
say "DONE. Logs: $LOGDIR (gateA.log, gateB.log; gate B verdict is the '0 not as expected' / '0 differ' lines). Gate work dir: $WORK"
