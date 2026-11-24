#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# One owner command for the nudge study's fill stage: the 3 cells the 450 cap left budget skipped (t1-nfr-report-queries
# list and filler #3, t2-dr-notify-fanout list #3), then the judge pass of those two tasks.
#   bash run-nudge-fill.sh [--plan]    free: cells, budgets and the worst case against the 60-credit cap
#   bash run-nudge-fill.sh --go        PAID (approved 2026-11-23: cap 60 counted credits); run detached, see below
#   bash run-nudge-fill.sh --judge-plan    free: judge calls and USD estimate for the two tasks
#   bash run-nudge-fill.sh --judge     PAID judge pass of the two tasks (cap USD 0.5), then the 8-task report
# Detached, so a closed terminal does not stop it:
#   setsid nohup bash <workspace>/scripts/run-nudge-fill.sh --go > <workspace>/reports/next-experiment-2026-11-22/run-nudge-fill.log 2>&1 < /dev/null &
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
X=$KONDUCTOR_WS/reports/next-experiment-2026-11-22
case "${1:---plan}" in
  --plan) exec sh "$X/run-nudge.sh" --fill --plan ;;
  --go) exec sh "$X/run-nudge.sh" --fill --go ;;
  --judge-plan) exec bash "$X/run-nudge-judge.sh" --fill --plan ;;
  --judge) exec bash "$X/run-nudge-judge.sh" --fill ;;
  *) echo "usage: run-nudge-fill.sh [--plan|--go|--judge-plan|--judge]" >&2; exit 2 ;;
esac
