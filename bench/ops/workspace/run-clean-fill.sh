#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# One owner command for the clean-run plan of 2026-11-24 (reports/clean-run-plan-2026-11-24.md): every cell the four
# setups still lack, then the judge passes of only the new cells, one paid job at a time.
#   bash run-clean-fill.sh [--plan]   free: each step's own plan (cells, budgets, caps, judge estimates)
#   CC_AWS_PROFILE=<profile> bash run-clean-fill.sh --go   PAID, in this order, stopping at the first failure:
#     1. Kiro Opus 5.5 fill: run-model-swap.sh --fill --go (t1-nfr-report-queries reps 2 and 3, cap 138 counted credits)
#     2. nudge judge: run-nudge-judge.sh --fill (t1-nfr-report-queries and t2-dr-notify-fanout, cap USD 0.5)
#     3. Opus fill judge: run-model-swap-judge.sh --fill (the 2 fill cells, cap USD 0.3)
#     4. Claude Code judge: run-cc-compare-judge.sh (every Claude Code task, cap USD 2)
# The Claude Code fill step is gone (owner, 2026-11-24, D-247): the study left 0 cells to fill.
# Refused while run-cc-compare.sh runs. Each step resumes on a rerun, so a rerun after a stop goes on where it stopped.
# Detached, so a closed terminal does not stop it:
#   CC_AWS_PROFILE=<profile> setsid nohup bash <workspace>/scripts/run-clean-fill.sh --go > <workspace>/reports/clean-fill-2026-11-24.log 2>&1 < /dev/null &
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
X=$KONDUCTOR_WS/reports/next-experiment-2026-11-22
say() { echo "[$(date -u +%H:%M)] $*"; }
step() { say "== $1"; shift; "$@"; }
case "${1:---plan}" in
  --plan)
    step "1 Kiro Opus fill (plan)" sh "$X/run-model-swap.sh" --fill --plan
    step "2 nudge judge (plan)" bash "$X/run-nudge-judge.sh" --fill --plan
    step "3 Opus fill judge (plan)" bash "$X/run-model-swap-judge.sh" --fill --plan
    step "4 Claude Code judge (plan)" bash "$X/run-cc-compare-judge.sh" --plan ;;
  --go)
    if pgrep -f 'run-cc-compare[.]sh' >/dev/null; then echo "stop: run-cc-compare.sh is still running; start this after it ends" >&2; exit 1; fi
    [ -n "${CC_AWS_PROFILE:-}" ] || { echo "stop: set CC_AWS_PROFILE (the AWS profile claude may use)" >&2; exit 1; }
    step "1 Kiro Opus fill" sh "$X/run-model-swap.sh" --fill --go
    step "2 nudge judge" bash "$X/run-nudge-judge.sh" --fill
    step "3 Opus fill judge" bash "$X/run-model-swap-judge.sh" --fill
    step "4 Claude Code judge" bash "$X/run-cc-compare-judge.sh"
    say "all four steps done" ;;
  *) echo "usage: run-clean-fill.sh [--plan|--go]" >&2; exit 2 ;;
esac
