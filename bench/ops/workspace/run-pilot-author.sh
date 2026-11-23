#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-pilot-author.sh -- keep-or-prune pilot, step 1 (PAID, approved: cap 120 counted credits): writes the 16 tasks
# of context:k-orchestrator-shared. glm-5 writes, deepseek-3.2 reviews, one fix, then a still failing task is dropped.
# At most 8 calls, each counted at 15 credits or its real cost, whichever is larger; the ledger is read before each
# call and a call that could pass 120 is refused.
#
#   bash $KONDUCTOR_WS/scripts/run-pilot-author.sh            # PAID
#   bash $KONDUCTOR_WS/scripts/run-pilot-author.sh --dry-run  # free: steps, worst case
#
# It moves its own checkout (konductor-plant/.worktrees/kp-pilot) to the pinned commit (the head at the first run, in
# reports/kp-pilot/pinned-commit; step 3 uses the same one), holds the heavy lock while it spends, checks that kiro-cli
# is signed in, and writes the baseline to reports/kp-pilot/unit-baselines/context-k-orchestrator-shared/baseline.json.
# A rerun resumes after the last finished call (the calls are saved in /var/tmp/konductor-kp-pilot/author). Safe to
# run under nohup or setsid. Env overrides: see scripts/kp-pilot-lib.sh.
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

main() {
  local self dry rc
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  dry=0
  rc=0
  case "${1:-}" in
    --dry-run) dry=1 ;;
    "") ;;
    -h|--help) sed -n '2,17p' "$0"; return 0 ;;
    *) echo "unknown argument: $1" >&2; return 64 ;;
  esac
  # shellcheck source=kp-pilot-lib.sh
  . "$self/kp-pilot-lib.sh"
  kp_setup author$([ "$dry" = 1 ] && echo -dry || true)
  kp_refresh
  kp_creds
  local -a vars=(KP_PILOT_WORK="$KP_WORK" KP_KIRO_BIN="$KP_BIN" KP_BASELINE_OUT="$KP_BASELINE")
  if [ "$dry" = 1 ]; then
    env "${vars[@]}" bash "$KP_WT/bench/cap/pilot/author-baseline.sh" --dry-run --cap 120 < /dev/null
    echo "dry run done; the paid command is: bash $self/run-pilot-author.sh"
    return 0
  fi
  kp_heavy_lock
  echo "PAID: writing the baseline, cap 120 counted credits"
  env "${vars[@]}" bash "$KP_WT/bench/cap/pilot/author-baseline.sh" --cap 120 < /dev/null || rc=$?
  if [ "$rc" = 0 ]; then
    echo "next (step 2, free): read $KP_BASELINE and set source.signedOffBy; see reports/kp-pilot-signoff-guide.md"
  elif [ "$rc" = 2 ]; then
    echo "some tasks were dropped: read ${KP_BASELINE%.json}.draft.json (source.dropped) and pick their replacements"
  else
    echo "step 1 stopped (exit $rc); the same command resumes it"
  fi
  echo "ledger: $KP_WORK/author-ledger.jsonl; log: $KP_LOGDIR/run.log"
  return "$rc"
}

main "$@"
