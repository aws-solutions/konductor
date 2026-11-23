#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-pilot-run.sh -- keep-or-prune pilot, step 3 (PAID, approved: cap 8,760 counted credits): the quick run of
# context:k-orchestrator-shared, keep arm against drop arm, judged by qwen3-coder-next, gpt-5.6-luna and grok-4.7.
# 552 calls, each counted at 15 credits or its real cost, whichever is larger (about 305 real credits expected).
#
#   bash $KONDUCTOR_WS/scripts/run-pilot-run.sh            # PAID
#   bash $KONDUCTOR_WS/scripts/run-pilot-run.sh --dry-run  # free: the three gates and the plan
#
# It refuses to start unless all three gates pass: (1) the baseline from step 1 is fresh and signed off
# (source.signedOffBy), (2) the judge panel seats three families, none the agent's, (3) the controls (convention
# control and dose ladder) load. It runs on the commit step 1 pinned (reports/kp-pilot/pinned-commit), holds the heavy
# lock while it spends, and checks that kiro-cli is
# signed in. A stop (the cap, a failed call) is resumed by the same command. Safe to run under nohup or setsid.
# Env overrides: see scripts/kp-pilot-lib.sh.
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

main() {
  local self dry rc plan
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  dry=0
  rc=0
  plan=""
  case "${1:-}" in
    --dry-run) dry=1 ;;
    "") ;;
    -h|--help) sed -n '2,17p' "$0"; return 0 ;;
    *) echo "unknown argument: $1" >&2; return 64 ;;
  esac
  # shellcheck source=kp-pilot-lib.sh
  . "$self/kp-pilot-lib.sh"
  kp_setup run$([ "$dry" = 1 ] && echo -dry || true)
  kp_refresh
  kp_creds
  local -a vars=(KP_PILOT_WORK="$KP_WORK" KP_KIRO_BIN="$KP_BIN" KP_BASELINES="$KP_BASE_DIR")

  # --- the three gates, from the run's own dry run (no call made) ---
  [ -f "$KP_BASELINE" ] || kp_stop "no baseline at $KP_BASELINE: run step 1 (run-pilot-author.sh) first"
  plan=$(env "${vars[@]}" bash "$KP_WT/bench/cap/pilot/run-pilot.sh" --dry-run --cap 8760 < /dev/null) || kp_stop "the run's dry run failed; no call was made"
  printf '%s\n' "$plan"
  local signed=FAIL panel=FAIL controls=FAIL
  if printf '%s\n' "$plan" | grep -q '^baseline fresh, signed off by ' && ! printf '%s\n' "$plan" | grep -q 'signed off by nobody yet'; then signed=PASS; fi
  if printf '%s\n' "$plan" | grep -q 'judges qwen3-coder-next, gpt-5.6-luna, grok-4.7$'; then panel=PASS; fi
  if printf '%s\n' "$plan" | grep -q '^controls loaded: '; then controls=PASS; fi
  echo "gate 1, baseline fresh and signed off: $signed"
  echo "gate 2, three judge families seated:   $panel"
  echo "gate 3, controls loaded:               $controls"
  if [ "$signed$panel$controls" != PASSPASSPASS ] || printf '%s\n' "$plan" | grep -q '^would stop before the first call'; then
    kp_stop "not started: a gate failed (see the lines above); no call was made"
  fi
  if [ "$dry" = 1 ]; then
    echo "dry run done; the paid command is: bash $self/run-pilot-run.sh"
    return 0
  fi
  kp_heavy_lock
  echo "PAID: the pilot run, cap 8,760 counted credits"
  env "${vars[@]}" bash "$KP_WT/bench/cap/pilot/run-pilot.sh" --cap 8760 < /dev/null || rc=$?
  [ "$rc" = 0 ] && echo "done: the record is under $KP_WORK/runs/kp-pilot-1/stage-4/" || echo "the run stopped (exit $rc); the same command resumes it"
  echo "ledger: $KP_WORK/run-ledger.jsonl; log: $KP_LOGDIR/run.log"
  return "$rc"
}

main "$@"
