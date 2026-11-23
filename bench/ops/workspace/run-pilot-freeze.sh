#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-pilot-freeze.sh -- keep-or-prune pilot, step 2 (FREE): after you read the tasks, freezes the draft
# (reports/kp-pilot/unit-baselines/context-k-orchestrator-shared/baseline.draft.json) into baseline.json with
# source.signedOffBy set to your alias. It refuses if baseline.json exists, if the unit changed since the draft, or if
# the draft is not a valid baseline (a dropped task must be recorded in source.dropped; 15 tasks are allowed).
#
#   bash $KONDUCTOR_WS/scripts/run-pilot-freeze.sh <your alias>
#
# The 15-task support is newer than the commit step 1 pinned, so this step moves the pin to the feat/bench-pilot-nk
# head and logs the move (reports/kp-pilot/pinned-commit.log); step 3 then runs on that commit. No model call.
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

main() {
  local self alias
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  alias=${1:-}
  case "$alias" in
    ""|-h|--help) sed -n '2,12p' "$0"; [ -n "$alias" ] && return 0; return 64 ;;
  esac
  # shellcheck source=kp-pilot-lib.sh
  . "$self/kp-pilot-lib.sh"
  kp_setup freeze
  kp_repin "freeze: 15-task baselines and the freeze step are newer than the step 1 pin"
  kp_refresh
  node "$KP_WT/bench/runner/bench.js" cap unit-author --kind context --unit k-orchestrator-shared --work "$KP_WORK/author" \
    --out "$KP_BASELINE" --sign-off "$alias" --repo-root "$KP_WT" < /dev/null
  echo "next (step 3): bash $self/run-pilot-run.sh --dry-run, then without --dry-run"
}

main "$@"
