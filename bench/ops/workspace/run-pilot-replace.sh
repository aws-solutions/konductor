#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-pilot-replace.sh -- keep-or-prune pilot, option B (PAID, inside the approved writing cap of 120: step 1 spent
# 90, so 30 are left, exactly these two calls): a new task for a dropped brief. deepseek-3.2 writes it and glm-5 reviews
# it, so neither family checks its own work. No fix: if the review fails, the task stays dropped and the failure is
# recorded. A passing task goes into the draft; then freeze it with run-pilot-freeze.sh.
#
#   bash $KONDUCTOR_WS/scripts/run-pilot-replace.sh --dry-run   # free: the 2 calls
#   bash $KONDUCTOR_WS/scripts/run-pilot-replace.sh             # PAID, t14
#
# Like the freeze, it moves the pin to the feat/bench-pilot-nk head (the replacement step is newer than the step 1 pin)
# and logs the move. It holds the kp lock and the heavy lock while it spends. KP_REPLACE_ID names another dropped task.
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

main() {
  local self dry id rc
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  dry=0
  id=${KP_REPLACE_ID:-t14}
  rc=0
  case "${1:-}" in
    --dry-run) dry=1 ;;
    "") ;;
    -h|--help) sed -n '2,14p' "$0"; return 0 ;;
    *) echo "unknown argument: $1" >&2; return 64 ;;
  esac
  # shellcheck source=kp-pilot-lib.sh
  . "$self/kp-pilot-lib.sh"
  kp_setup replace$([ "$dry" = 1 ] && echo -dry || true)
  [ -f "${KP_BASELINE%.json}.draft.json" ] || kp_stop "no draft at ${KP_BASELINE%.json}.draft.json: step 1 wrote none"
  # The dry run looks at the head for this run only (the pin does not move); the paid run moves the pin and logs it.
  if [ "$dry" = 1 ]; then KP_REF=${KP_REF:-origin/feat/bench-pilot-nk}; else kp_repin "replace $id: the replacement step is newer than the step 1 pin"; fi
  kp_refresh
  kp_creds
  local -a cmd=(node "$KP_WT/bench/runner/bench.js" cap unit-author --kind context --unit k-orchestrator-shared
    --work "$KP_WORK/author" --ledger "$KP_WORK/author-ledger.jsonl" --cap 120 --out "$KP_BASELINE" --replace "$id"
    --kiro-bin "$KP_BIN" --repo-root "$KP_WT")
  [ -n "${KP_AUTH_DB:-}" ] && cmd+=(--auth-db "$KP_AUTH_DB")
  if [ "$dry" = 1 ]; then
    "${cmd[@]}" --dry-run < /dev/null
    echo "dry run done; the paid run first moves the pin to the head and logs it"
    return 0
  fi
  exec 9>"${KP_PILOT_LOCK:-/var/tmp/konductor-kp-pilot.lock}"
  flock -x 9
  kp_heavy_lock
  kp_sweep "$KP_WORK/author"
  echo "PAID: replacing $id, at most 2 calls, inside the writing cap of 120 counted credits"
  "${cmd[@]}" < /dev/null || rc=$?
  [ "$rc" = 0 ] && echo "next: read the new task in the draft, then bash $self/run-pilot-freeze.sh <your alias>" || echo "$id was not replaced (exit $rc); see above"
  echo "ledger: $KP_WORK/author-ledger.jsonl; log: $KP_LOGDIR/run.log"
  return "$rc"
}

main "$@"
