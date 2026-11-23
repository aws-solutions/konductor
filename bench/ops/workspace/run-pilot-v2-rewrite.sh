#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-pilot-v2-rewrite.sh -- the pilot baseline, version 2 (PAID, approved: cap 120 counted credits): writes again the
# five tasks both reviews rated BAD (t01, t07, t09, t12, t16; workspace reports/pilot-baseline-review-combined-2026-11-23.md)
# from bench/cap/unit-baselines/context-k-orchestrator-shared/rewrite-v2.json. deepseek-3.2 writes and glm-5 reviews
# (glm-5 wrote the first tasks), in one batch: write, review, one fix, recheck; a task that still fails is dropped and
# recorded, never fixed by hand. At most 4 calls, each counted at 15 credits or its real cost, whichever is larger
# (worst case 60); the ledger is read before each call and a call that could pass the cap is refused.
#
#   bash $KONDUCTOR_WS/scripts/run-pilot-v2-rewrite.sh --dry-run  # free: the steps, their models, the worst case
#   bash $KONDUCTOR_WS/scripts/run-pilot-v2-rewrite.sh            # PAID
#
# The ten other tasks (t02 to t06, t08, t10, t11, t13, t15) are copied byte for byte, and the script checks that after
# the run. It reads the signed-off pilot baseline (reports/kp-pilot/unit-baselines/...; never changed) and writes
# reports/kp-pilot/unit-baselines-v2/context-k-orchestrator-shared/baseline.json (or .draft.json when a rewrite was
# dropped), with no sign-off. Own checkout (konductor-plant/.worktrees/kp-v2, pinned in reports/kp-pilot-v2/pinned-commit
# at the first run; the pilot's own checkout and pin are not touched), own work dir (/var/tmp/konductor-kp-v2; a rerun
# resumes after the last saved call). Holds the heavy lock while it spends.
# Env overrides: KP_* as in kp-pilot-lib.sh; V2_FROM (the baseline to rewrite); V2_CAP (at most 120).
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

main() {
  local self dry rc cap lock rewrite from
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  dry=0
  rc=0
  cap=${V2_CAP:-120}
  lock=${V2_LOCK:-/var/tmp/konductor-kp-v2.lock}
  from=${V2_FROM:-$KONDUCTOR_WS/reports/kp-pilot/unit-baselines/context-k-orchestrator-shared/baseline.json}
  rewrite=""
  case "${1:-}" in
    --dry-run) dry=1 ;;
    "") ;;
    -h|--help) sed -n '2,21p' "$0"; return 0 ;;
    *) echo "unknown argument: $1" >&2; return 64 ;;
  esac
  case "$cap" in ''|*[!0-9]*) echo "V2_CAP must be a whole number" >&2; return 64 ;; esac
  [ "$cap" -le 120 ] || { echo "V2_CAP $cap is over the 120 the owner approved for the rewrite" >&2; return 64; }
  export KP_WT_NAME=${KP_WT_NAME:-kp-v2}
  export KP_PIN_FILE=${KP_PIN_FILE:-$KONDUCTOR_WS/reports/kp-pilot-v2/pinned-commit}
  export KP_PILOT_WORK=${KP_PILOT_WORK:-/var/tmp/konductor-kp-v2}
  export KP_BASELINES=${KP_BASELINES:-$KONDUCTOR_WS/reports/kp-pilot/unit-baselines-v2}
  # shellcheck source=kp-pilot-lib.sh
  . "$self/kp-pilot-lib.sh"
  kp_setup v2-rewrite$([ "$dry" = 1 ] && echo -dry || true)
  kp_refresh
  rewrite=$KP_WT/bench/cap/unit-baselines/context-k-orchestrator-shared/rewrite-v2.json
  [ -f "$rewrite" ] || kp_stop "$rewrite is missing at the pinned commit: delete $KP_PIN_FILE to pin a newer head"
  [ -f "$from" ] || kp_stop "no baseline to rewrite at $from"
  [ "$dry" = 1 ] || kp_creds
  local -a cmd=(node "$KP_WT/bench/runner/bench.js" cap unit-author --kind context --unit k-orchestrator-shared
    --rewrite "$rewrite" --from "$from" --out "$KP_BASELINE" --work "$KP_WORK/author" --ledger "$KP_WORK/author-ledger.jsonl"
    --kiro-bin "$KP_BIN" --repo-root "$KP_WT" --cap "$cap")
  [ -n "${KP_AUTH_DB:-}" ] && cmd+=(--auth-db "$KP_AUTH_DB")
  if [ "$dry" = 1 ]; then
    "${cmd[@]}" --dry-run < /dev/null
    echo "dry run done; the paid command is: bash $KONDUCTOR_WS/scripts/run-pilot-v2-rewrite.sh"
    return 0
  fi
  kp_heavy_lock
  exec 9>"$lock"
  flock -x 9
  # Under this lock no call of ours runs, so a scratch HOME left in the work dir is from a killed run and still holds a
  # sign-in copy: remove it before the first call.
  kp_sweep "$KP_WORK/author"
  echo "PAID: the pilot baseline v2 rewrite, cap $cap counted credits"
  "${cmd[@]}" < /dev/null || rc=$?
  local out=$KP_BASELINE
  [ "$rc" = 2 ] && out=${KP_BASELINE%.json}.draft.json
  if [ "$rc" = 0 ] || [ "$rc" = 2 ]; then
    # The kept tasks must be the same bytes as in the signed-off baseline.
    node -e '
      const fs = require("fs"); const [from, to] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
      const by = (b) => new Map(b.batches.flatMap((x) => x.tasks.map((t) => [t.id, JSON.stringify(t, null, 2)])));
      const [a, b] = [by(from), by(to)]; const bad = to.source.kept.filter((id) => a.get(id) !== b.get(id));
      if (bad.length) { console.error(`STOP: kept tasks differ from the signed-off baseline: ${bad.join(", ")}`); process.exit(1); }
      console.log(`kept ${to.source.kept.length} tasks byte for byte; rewritten: ${to.source.rewritten.join(", ") || "none"}; dropped now: ${to.source.dropped.map((d) => d.id).join(", ")}`);
    ' "$from" "$out" || rc=1
  fi
  if [ "$rc" = 0 ]; then echo "next (free): Fable reads $out with reports/kp-pilot-v2/fable-review-brief.md, then a person who did not write the tasks signs it off"
  elif [ "$rc" = 2 ]; then echo "a rewrite was dropped: read $out (source.dropped); the owner decides what replaces it"
  else echo "stopped (exit $rc); the same command resumes it"; fi
  echo "ledger: $KP_WORK/author-ledger.jsonl; log: $KP_LOGDIR/run.log"
  return "$rc"
}

main "$@"
