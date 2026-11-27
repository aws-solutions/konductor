#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# D-275 and D-276: three non-Claude families (gpt-5.6-luna, deepseek-3.2, glm-5) each read the rules, interface, hidden
# tests and goldens of cx-carddemo-port and cx-carddemo-batchday and report test-vs-rule mismatches. Six calls.
# --plan (the default) is free. --go is PAID and needs your own cap, in counted credits (15 per call or its real
# credits, whichever is more): the job stops before the call that could pass it.
#   bash run-debt-d275-cx-recheck.sh [--plan]
#   bash run-debt-d275-cx-recheck.sh --go --cap 105 [--call-worst N]
# --call-worst N: a call's worst case in counted credits for the check before each call (default 15; a model's own
# highest real cost in the ledger counts too). One glm-5 call on the bundle cost 110, so set it to the real worst.
# Engine and rules: debt-paid/run.sh. The tasks are read from its own checkout, $KONDUCTOR_WS/worktrees/cx-recheck
# (made at origin/feat/bench-pilot-nk on the first run), so push the task changes first.
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MODE=--plan CAP= WORST=
while [ $# -gt 0 ]; do
  case "$1" in
    --plan|--go) MODE=$1 ;;
    --cap) shift; CAP=${1:-} ;;
    --call-worst) shift; WORST=${1:-} ;;
    *) echo "usage: bash $0 [--plan | --go --cap N [--call-worst N]]"; exit 64 ;;
  esac
  shift
done
if [ "$MODE" = --go ]; then
  case "$CAP" in ''|*[!0-9]*) echo "--go needs --cap N, N a whole number of counted credits (the plan suggests 105)"; exit 64 ;; esac
  [ "$CAP" -ge 15 ] || { echo "--cap $CAP leaves no room for one 15-credit call"; exit 64; }
fi
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
UPDATE_PIN=${PIN_REPO:+0}   # a PIN_REPO you set yourself (the test hook) is never moved
export PIN_REPO=${PIN_REPO:-$KONDUCTOR_WS/worktrees/cx-recheck}
# An older checkout of this job's own folder moves to the branch head, but only while nothing is spent and it is clean.
if [ "${UPDATE_PIN:-1}" = 1 ] && [ -e "$PIN_REPO/.git" ] && [ ! -s "${ROOT:-$KONDUCTOR_WS/reports/debt-paid/D-275}/ledger" ] && [ -z "$(git -C "$PIN_REPO" status --porcelain)" ]; then
  git -C "$PIN_REPO" fetch -q origin feat/bench-pilot-nk && git -C "$PIN_REPO" checkout -q --detach FETCH_HEAD
fi
if [ -n "$CAP" ]; then
  JOBS=$(mktemp "${TMPDIR:-/var/tmp}/d275-jobs.XXXXXX") || exit 1
  trap 'rm -f -- "$JOBS"' EXIT
  awk -v c="$CAP" '$1 == "cap" && $2 == "D-275" { $3 = c } { print }' "$HERE/debt-paid/jobs.txt" > "$JOBS"
  export JOBS
fi
# Not exec: the trap above must run when the engine ends.
bash "$HERE/debt-paid/run.sh" D-275 "$MODE" ${WORST:+--call-worst "$WORST"}
