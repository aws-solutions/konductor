#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-fw30-rewrite.sh -- FW-30 (PAID, needs the owner's approval; cap 120 counted credits): writes the pilot tasks of
# context:k-orchestrator-shared again from briefs-fw30.json (the combined review of 2026-11-23: 12 rewrites and 4 new
# tasks). deepseek-3.2 writes and glm-5 reviews (glm-5 wrote the first tasks), one fix, then a still failing task is
# dropped and recorded; never fixed by hand. At most 8 calls, each counted at 15 credits or its real cost, whichever is
# larger; the ledger is read before each call and a call that could pass the cap is refused. The plan priced FW-30 at
# 720 because it counted 3 calls per task; cap unit-author writes a batch of 8 in one call, so the worst case is 120.
#
#   bash $KONDUCTOR_WS/scripts/run-fw30-rewrite.sh --dry-run  # free: the steps, their models, the worst case
#   bash $KONDUCTOR_WS/scripts/run-fw30-rewrite.sh            # PAID
#
# It uses its own checkout (konductor-plant/.worktrees/fw30, pinned in reports/fw30/pinned-commit at the first run),
# its own work dir (/var/tmp/konductor-fw30; a rerun resumes after the last saved call) and writes
# reports/fw30/unit-baselines/context-k-orchestrator-shared/baseline.json (or .draft.json when a task was dropped).
# The pilot's baseline is never touched. The KEEP tasks t04, t05, t11 and t13 are not in the briefs; whether the new
# set replaces or joins the old one is the owner's call after sign-off. Holds the heavy lock while it spends.
# Env overrides: KP_* as in kp-pilot-lib.sh; FW30_CAP (at most 120).
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

main() {
  local self dry rc cap lock briefs
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  dry=0
  rc=0
  cap=${FW30_CAP:-120}
  lock=${FW30_LOCK:-/var/tmp/konductor-fw30.lock}
  briefs=""
  case "${1:-}" in
    --dry-run) dry=1 ;;
    "") ;;
    -h|--help) sed -n '2,19p' "$0"; return 0 ;;
    *) echo "unknown argument: $1" >&2; return 64 ;;
  esac
  case "$cap" in ''|*[!0-9]*) echo "FW30_CAP must be a whole number" >&2; return 64 ;; esac
  [ "$cap" -le 120 ] || { echo "FW30_CAP $cap is over the 120 the plan sets for FW-30" >&2; return 64; }
  export KP_WT_NAME=${KP_WT_NAME:-fw30}
  export KP_PIN_FILE=${KP_PIN_FILE:-$KONDUCTOR_WS/reports/fw30/pinned-commit}
  export KP_PILOT_WORK=${KP_PILOT_WORK:-/var/tmp/konductor-fw30}
  export KP_BASELINES=${KP_BASELINES:-$KONDUCTOR_WS/reports/fw30/unit-baselines}
  # shellcheck source=kp-pilot-lib.sh
  . "$self/kp-pilot-lib.sh"
  kp_setup fw30$([ "$dry" = 1 ] && echo -dry || true)
  kp_refresh
  briefs=$KP_WT/bench/cap/unit-baselines/context-k-orchestrator-shared/briefs-fw30.json
  [ -f "$briefs" ] || kp_stop "$briefs is missing at the pinned commit: delete $KP_PIN_FILE to pin a newer head"
  kp_creds
  local -a cmd=(node "$KP_WT/bench/runner/bench.js" cap unit-author --kind context --unit k-orchestrator-shared
    --briefs "$briefs" --work "$KP_WORK/author" --ledger "$KP_WORK/author-ledger.jsonl" --out "$KP_BASELINE"
    --kiro-bin "$KP_BIN" --repo-root "$KP_WT" --cap "$cap")
  [ -n "${KP_AUTH_DB:-}" ] && cmd+=(--auth-db "$KP_AUTH_DB")
  if [ "$dry" = 1 ]; then
    "${cmd[@]}" --dry-run < /dev/null
    echo "dry run done; the paid command is: bash $self/run-fw30-rewrite.sh"
    return 0
  fi
  kp_heavy_lock
  exec 9>"$lock"
  flock -x 9
  # Under this lock no call of ours runs, so a scratch HOME left in the work dir is from a killed run and still holds a
  # sign-in copy: remove it before the first call.
  kp_sweep "$KP_WORK/author"
  echo "PAID: FW-30 rewrite, cap $cap counted credits"
  "${cmd[@]}" < /dev/null || rc=$?
  if [ "$rc" = 0 ]; then echo "next (free): a person who did not write the tasks reads $KP_BASELINE and signs it off"
  elif [ "$rc" = 2 ]; then echo "some tasks were dropped: read ${KP_BASELINE%.json}.draft.json (source.dropped)"
  else echo "stopped (exit $rc); the same command resumes it"; fi
  echo "ledger: $KP_WORK/author-ledger.jsonl; log: $KP_LOGDIR/run.log"
  return "$rc"
}

main "$@"
