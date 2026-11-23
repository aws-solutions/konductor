#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Runs the first keep-or-prune pilot: context:k-orchestrator-shared at quick depth, keep arm (the file loaded) against
# drop arm (no file), judged by qwen3-coder-next, gpt-5.6-luna and grok-4.7 (three families, none the agent's). PAID:
# run it only with the owner's approved cap, after the baseline is written and signed off.
#
#   bash bench/cap/pilot/run-pilot.sh --dry-run             # free: the calls, the worst case, the ledger, any blocker
#   bash bench/cap/pilot/run-pilot.sh --cap 8760            # paid: 552 calls, at most 8,280 counted at 15 per call
#                                                           # (about 305 real); stops at the cap, the same command resumes
#
# Every call is a one-turn kiro-cli call with no tools, counted at the larger of 15 and its real credits; the ledger
# is read before each one and a call that could pass the cap is refused. The run stops before its first call when the
# unit has no fresh baseline or the panel is short of three families. Answers, checklists and judgments are saved
# under the run folder, so rerunning after a stop (or with a larger cap) makes only the missing calls.
# Env: KP_PILOT_WORK (work dir, outside the home folder; default /var/tmp/konductor-kp-pilot), KP_PILOT_RUN (run id,
# default kp-pilot-1), KP_PILOT_MODEL (the agent, default claude-sonnet-5.5), KP_BASELINES (the unit baselines dir,
# default bench/cap/unit-baselines; the baseline must be signed off), KP_PILOT_LEDGER (default <work>/run-ledger.jsonl),
# KP_CONTROLS_ONLY (any value: run the two controls only), KP_ROLE_LINE (any value: both arms of each unit task start
# with the role line, FW-36), KP_KIRO_BIN, KP_AUTH_DB, KP_PILOT_LOCK.
set -euo pipefail

main() {
  local here repo dry cap work run model bin authdb lock baselines ledger only role stale=""
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  baselines=${KP_BASELINES:-}
  ledger=${KP_PILOT_LEDGER:-}
  only=${KP_CONTROLS_ONLY:-}
  role=${KP_ROLE_LINE:-}
  repo=$(cd "$here/../../.." && pwd)
  dry=0
  cap=""
  work=${KP_PILOT_WORK:-/var/tmp/konductor-kp-pilot}
  run=${KP_PILOT_RUN:-kp-pilot-1}
  model=${KP_PILOT_MODEL:-claude-sonnet-5.5}
  bin=${KP_KIRO_BIN:-kiro-cli}
  authdb=${KP_AUTH_DB:-}
  lock=${KP_PILOT_LOCK:-/var/tmp/konductor-kp-pilot.lock}
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      --cap) cap=${2:?--cap needs a number}; shift ;;
      -h|--help) sed -n '2,19p' "$0"; return 0 ;;
      *) echo "unknown argument: $1" >&2; return 64 ;;
    esac
    shift
  done
  local -a cmd=(node "$repo/bench/runner/bench.js" cap unit-stage --kind context --unit k-orchestrator-shared
    --provider kiro --run "$run" --depth quick --model "$model" --judges qwen3-coder-next,gpt-5.6-luna,grok-4.7
    --ledger "${ledger:-$work/run-ledger.jsonl}" --work "$work/scratch" --out "$work/runs" --kiro-bin "$bin" --repo-root "$repo")
  [ -n "$baselines" ] && cmd+=(--baselines "$baselines")
  [ -n "$only" ] && cmd+=(--controls-only)
  [ -n "$role" ] && cmd+=(--role-line)
  [ -n "$cap" ] && cmd+=(--cap "$cap")
  [ -n "$authdb" ] && cmd+=(--auth-db "$authdb")
  if [ "$dry" = 1 ]; then
    "${cmd[@]}" --dry-run
    return
  fi
  if [ -z "$cap" ]; then
    echo "a paid run needs --cap N: the credits the owner approved for the pilot run" >&2
    return 64
  fi
  mkdir -p "$(dirname "$lock")"
  exec 9>"$lock"
  flock -x 9
  # Under the lock no call of ours is running, so any scratch HOME left here is from a killed run (SIGKILL skips the
  # cleanup) and still holds a copy of the sign-in database: remove it before the first call.
  while IFS= read -r stale; do
    chmod -R u+rwX "$stale" && find "$stale" -depth -delete && echo "removed a stale scratch HOME (sign-in copy) from a killed run: $stale"
  done < <(find "$work/scratch" -mindepth 1 -maxdepth 1 -type d -name 'home-*' 2>/dev/null)
  "${cmd[@]}"
}

main "$@"
