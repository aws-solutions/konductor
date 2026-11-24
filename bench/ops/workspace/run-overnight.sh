#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Overnight chain for the clean-run fills (2026-11-24). Start it once from the workspace, then go to sleep:
#   setsid nohup bash scripts/run-overnight.sh > reports/overnight-2026-11-24.log 2>&1 < /dev/null &
#
# What it does, in order (every step is already approved, with its own cap):
#   0. keeps the judge credentials fresh in the background (scripts/keep-creds-fresh.sh, local only) until the chain ends
#   1. waits until the Claude Code study (run-cc-compare.sh) has ended; gives up after MAX_WAIT_MIN (480) minutes
#   2. run-clean-fill.sh --go : Opus fill (cap 138 counted credits), the hook-fill judge (USD 0.5 cap), the Opus-fill
#      judge (USD 0.3 cap), the Claude Code judge (USD 2 cap)
#   3. the Claude Code judge (run-cc-compare-judge.sh, USD 2 cap), after its own free --plan
# It stops at the first step that fails, and says which one. Nothing else is started.
# Needs KONDUCTOR_WS (the launcher in <workspace>/scripts sets it). Test overrides: OVERNIGHT_WAIT_PAT, OVERNIGHT_POLL_S,
# MAX_WAIT_MIN (bench/ops/workspace/test-run-overnight-stub.sh).
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
W=$KONDUCTOR_WS
E=$W/reports/next-experiment-2026-11-22
export CC_AWS_PROFILE=${CC_AWS_PROFILE:-default}
MAX_WAIT_MIN=${MAX_WAIT_MIN:-480}
WAIT_PAT=${OVERNIGHT_WAIT_PAT:-run-cc-compare[.]sh}
POLL_S=${OVERNIGHT_POLL_S:-120}
refresher_pid=""

log() { echo "[$(date -u +%H:%M)] $*"; }

cleanup() {
  if [ -n "$refresher_pid" ]; then kill "$refresher_pid" 2>/dev/null; fi
  log "overnight chain ended"
}
trap cleanup EXIT

step() {  # step NAME CMD...: run one step, stop the chain if it fails
  local name=$1 rc=0; shift
  log "START $name"
  "$@" || rc=$?
  if [ "$rc" -ne 0 ]; then log "FAILED $name (exit $rc): chain stopped"; exit "$rc"; fi
  log "DONE $name"
}

if [ -f "$W/scripts/keep-creds-fresh.sh" ]; then
  bash "$W/scripts/keep-creds-fresh.sh" &
  refresher_pid=$!
  log "credential refresher started (pid $refresher_pid)"
else
  log "no keep-creds-fresh.sh: credentials may expire overnight"
fi

waited=0
while pgrep -f "$WAIT_PAT" > /dev/null; do
  if [ "$waited" -ge "$MAX_WAIT_MIN" ]; then log "the Claude Code study still runs after $MAX_WAIT_MIN min: giving up"; exit 3; fi
  sleep "$POLL_S"
  waited=$((waited + 2))
done
log "the Claude Code study has ended (waited $waited min)"

step "clean fills and their judges" bash "$W/scripts/run-clean-fill.sh" --go
step "Claude Code judge plan (free)" bash "$E/run-cc-compare-judge.sh" --plan
step "Claude Code judge" bash "$E/run-cc-compare-judge.sh"
log "all steps done: tell mate, a worker rebuilds the final report"
