#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Writes the frozen baseline of the first keep-or-prune pilot unit, context:k-orchestrator-shared. PAID: run it only
# with the owner's approved cap.
#
#   bash bench/cap/pilot/author-baseline.sh --dry-run          # free: the steps, the worst case, the ledger
#   bash bench/cap/pilot/author-baseline.sh --cap 120          # paid: at most 8 calls, 120 credits at 15 per call
#
# glm-5 writes the 16 tasks from the briefs (bench/cap/unit-baselines/context-k-orchestrator-shared/briefs.json),
# deepseek-3.2 reviews them, a failed task gets one fix by glm-5 and one recheck, and a task that still fails is
# dropped and recorded, never fixed by hand. The ledger is read before every call, each counted at the larger of 15
# and its real credits, and a call is refused when it could pass the cap. A rerun resumes after the last finished
# step. On success it writes bench/cap/unit-baselines/context-k-orchestrator-shared/baseline.json for the owner to sign
# off; with drops it writes baseline.draft.json and exits 2.
# Env: KP_PILOT_WORK (work dir, outside the home folder; default /var/tmp/konductor-kp-pilot), KP_KIRO_BIN (default
# kiro-cli), KP_AUTH_DB (the sign-in database to copy, default kiro-cli's own), KP_BASELINE_OUT (where baseline.json
# goes), KP_PILOT_LOCK (one run at a time).
set -euo pipefail

main() {
  local here repo dry cap work bin authdb out lock
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  repo=$(cd "$here/../../.." && pwd)
  dry=0
  cap=""
  work=${KP_PILOT_WORK:-/var/tmp/konductor-kp-pilot}
  bin=${KP_KIRO_BIN:-kiro-cli}
  authdb=${KP_AUTH_DB:-}
  out=${KP_BASELINE_OUT:-$repo/bench/cap/unit-baselines/context-k-orchestrator-shared/baseline.json}
  lock=${KP_PILOT_LOCK:-/var/tmp/konductor-kp-pilot.lock}
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      --cap) cap=${2:?--cap needs a number}; shift ;;
      -h|--help) sed -n '2,17p' "$0"; return 0 ;;
      *) echo "unknown argument: $1" >&2; return 64 ;;
    esac
    shift
  done
  local -a cmd=(node "$repo/bench/runner/bench.js" cap unit-author --kind context --unit k-orchestrator-shared
    --work "$work/author" --ledger "$work/author-ledger.jsonl" --out "$out" --kiro-bin "$bin" --repo-root "$repo")
  [ -n "$cap" ] && cmd+=(--cap "$cap")
  [ -n "$authdb" ] && cmd+=(--auth-db "$authdb")
  if [ "$dry" = 1 ]; then
    "${cmd[@]}" --dry-run
    return
  fi
  if [ -z "$cap" ]; then
    echo "a paid run needs --cap N: the credits the owner approved for writing the baseline" >&2
    return 64
  fi
  mkdir -p "$(dirname "$lock")"
  exec 9>"$lock"
  flock -x 9
  "${cmd[@]}"
}

main "$@"
