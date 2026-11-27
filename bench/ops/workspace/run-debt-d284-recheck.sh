#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# D-284: a deepseek-3.2 recheck of the three task versions that changed only their regress-kit time limits
# (t8-bug-retry-storm v4, t9-browser-tab-regression v3, t9-bug-tabs-focus v2), so `scenarios ready` has the
# review.recheck each hand-edited version needs. Three calls, a hard cap of 45 counted credits (15 per call or its real
# credits, whichever is more; the owner's approval of 2026-11-27): the job stops before the call that could pass it.
#   bash run-debt-d284-recheck.sh [--plan]   free: builds the three bundles and prompts, no model call
#   bash run-debt-d284-recheck.sh --go       PAID
# No --cap or --call-worst flag: the cap is the one in debt-paid/jobs.txt. Engine and rules: debt-paid/run.sh. The tasks
# are read from this job's own checkout, $KONDUCTOR_WS/worktrees/d284-recheck (made at origin/feat/bench-pilot-nk on
# the first run, moved to the branch head while nothing is spent). A worker records each result in the task's
# review.recheck (free).
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
case "${1:---plan}" in --plan|--go) ;; *) echo "usage: bash $0 [--plan|--go]"; exit 64 ;; esac
[ $# -le 1 ] || { echo "usage: bash $0 [--plan|--go]"; exit 64; }
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
. "$HERE/debt-paid/own-pin.sh"
own_pin D-284 "$KONDUCTOR_WS/worktrees/d284-recheck"
exec bash "$HERE/debt-paid/run.sh" D-284 "${1:---plan}"
