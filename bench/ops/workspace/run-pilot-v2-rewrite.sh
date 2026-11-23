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
#
#   bash $KONDUCTOR_WS/scripts/run-pilot-v2-rewrite.sh --redo t09 [--dry-run]   # PAID: one last try at one v2 task
#   bash $KONDUCTOR_WS/scripts/run-pilot-v2-rewrite.sh --sign-off NAME           # free: signs v2 off (or its draft)
#
# --redo ID writes that task again from rewrite-v2-redo-ID.json (the review's notes in the writer and reviewer prompts):
# deepseek-3.2 writes, glm-5 reviews, no fix; a fail drops the task and records it, never fixed by hand. Two calls
# (30 counted worst), on the same ledger, so the 120 cap covers both runs. It moves v2 aside to
# baseline.before-redo-ID.json, rewrites from there, and keeps the version (v2 was never signed off). The first paid
# redo pins the feat/bench-pilot-nk head (logged). --sign-off NAME freezes v2 with source.signedOffBy; after a drop it
# freezes the draft (14 tasks).
# Env overrides: KP_* as in kp-pilot-lib.sh; V2_FROM (the baseline to rewrite); V2_CAP (at most 120).
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

main() {
  local self dry rc cap lock rewrite from out redo signer dir before
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  dry=0
  rc=0
  cap=${V2_CAP:-120}
  lock=${V2_LOCK:-/var/tmp/konductor-kp-v2.lock}
  from=${V2_FROM:-$KONDUCTOR_WS/reports/kp-pilot/unit-baselines/context-k-orchestrator-shared/baseline.json}
  rewrite=""
  out=""
  redo=""
  signer=""
  dir=""
  before=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      --redo) redo=${2:?--redo needs a task id}; shift ;;
      --sign-off) signer=${2:?--sign-off needs the name of the person who read the tasks}; shift ;;
      -h|--help) sed -n '2,30p' "$0"; return 0 ;;
      *) echo "unknown argument: $1" >&2; return 64 ;;
    esac
    shift
  done
  case "$redo" in ''|t[0-9][0-9]) ;; *) echo "--redo takes a task id like t09" >&2; return 64 ;; esac
  case "$cap" in ''|*[!0-9]*) echo "V2_CAP must be a whole number" >&2; return 64 ;; esac
  [ "$cap" -le 120 ] || { echo "V2_CAP $cap is over the 120 the owner approved for the rewrite" >&2; return 64; }
  export KP_WT_NAME=${KP_WT_NAME:-kp-v2}
  export KP_PIN_FILE=${KP_PIN_FILE:-$KONDUCTOR_WS/reports/kp-pilot-v2/pinned-commit}
  export KP_PILOT_WORK=${KP_PILOT_WORK:-/var/tmp/konductor-kp-v2}
  export KP_BASELINES=${KP_BASELINES:-$KONDUCTOR_WS/reports/kp-pilot/unit-baselines-v2}
  # shellcheck source=kp-pilot-lib.sh
  . "$self/kp-pilot-lib.sh"
  kp_setup "v2-rewrite${redo:+-redo-$redo}${signer:+-sign-off}$([ "$dry" = 1 ] && echo -dry || true)"
  dir=$(dirname "$KP_BASELINE")
  # A redo needs code newer than the first rewrite's pin: a dry run reads the head, the first paid redo pins it once.
  if [ -n "$redo" ] && ! grep -qF "v2 redo $redo" "$KP_PIN_FILE.log" 2>/dev/null; then
    if [ "$dry" = 1 ]; then export KP_REF=${KP_REF:-origin/feat/bench-pilot-nk}; echo "dry run: reading the feat/bench-pilot-nk head; the paid redo pins it"
    else kp_repin "v2 redo $redo"; fi
  fi
  kp_refresh
  if [ -n "$signer" ]; then
    # Free: freeze v2 with the reader's name. An unsigned baseline.json becomes the draft first, so one path checks it.
    if [ ! -f "${KP_BASELINE%.json}.draft.json" ]; then
      [ -f "$KP_BASELINE" ] || kp_stop "no v2 at $KP_BASELINE"
      node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).source.signedOffBy?1:0)' "$KP_BASELINE" || kp_stop "$KP_BASELINE is already signed off"
      mv "$KP_BASELINE" "${KP_BASELINE%.json}.draft.json"
    fi
    node "$KP_WT/bench/runner/bench.js" cap unit-author --kind context --unit k-orchestrator-shared --sign-off "$signer" \
      --out "$KP_BASELINE" --work "$KP_WORK/author" --repo-root "$KP_WT" < /dev/null || kp_stop "the sign-off failed (see above); nothing was changed"
    return 0
  fi
  rewrite=$KP_WT/bench/cap/unit-baselines/context-k-orchestrator-shared/rewrite-v2${redo:+-redo-$redo}.json
  [ -f "$rewrite" ] || kp_stop "$rewrite is missing at the pinned commit: delete $KP_PIN_FILE to pin a newer head"
  if [ -n "$redo" ]; then
    before=$dir/baseline.before-redo-$redo.json
    if [ ! -f "$before" ]; then
      [ -f "$KP_BASELINE" ] || kp_stop "no v2 at $KP_BASELINE to redo $redo in"
      node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).source.signedOffBy?1:0)' "$KP_BASELINE" || kp_stop "$KP_BASELINE is signed off; a redo needs a new version instead"
      # The dry run reads v2 where it is; the paid run moves it aside first, so the rerun never reads the old task.
      if [ "$dry" = 1 ]; then before=$KP_BASELINE; else mv "$KP_BASELINE" "$before"; echo "moved v2 aside: $before"; fi
    fi
    from=$before
  fi
  [ -f "$from" ] || kp_stop "no baseline to rewrite at $from"
  [ "$dry" = 1 ] || kp_creds
  local -a cmd=(node "$KP_WT/bench/runner/bench.js" cap unit-author --kind context --unit k-orchestrator-shared
    --rewrite "$rewrite" --from "$from" --out "$KP_BASELINE" --work "$KP_WORK/author" --ledger "$KP_WORK/author-ledger.jsonl"
    --kiro-bin "$KP_BIN" --repo-root "$KP_WT" --cap "$cap")
  [ -n "${KP_AUTH_DB:-}" ] && cmd+=(--auth-db "$KP_AUTH_DB")
  if [ "$dry" = 1 ]; then
    "${cmd[@]}" --dry-run < /dev/null
    echo "dry run done; the paid command is: bash $KONDUCTOR_WS/scripts/run-pilot-v2-rewrite.sh${redo:+ --redo $redo}"
    return 0
  fi
  kp_heavy_lock
  exec 9>"$lock"
  flock -x 9
  # Under this lock no call of ours runs, so a scratch HOME left in the work dir is from a killed run and still holds a
  # sign-in copy: remove it before the first call.
  kp_sweep "$KP_WORK/author"
  echo "PAID: the pilot baseline v2 ${redo:+redo of $redo}${redo:-rewrite}, cap $cap counted credits on the shared ledger"
  "${cmd[@]}" < /dev/null || rc=$?
  # Exit 2 is also bench's exit for an error, so a drop is read from the draft file, not from the code alone.
  out=$KP_BASELINE
  if [ "$rc" = 2 ]; then
    out=${KP_BASELINE%.json}.draft.json
    [ -f "$out" ] || rc=1
  fi
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
  if [ "$rc" = 0 ] && [ -n "$redo" ]; then echo "next (free): Fable reads $redo again in $out, then the review mark and the sign-off (--sign-off NAME)"
  elif [ "$rc" = 0 ]; then echo "next (free): Fable reads $out with reports/kp-pilot-v2/fable-review-brief.md, then a person who did not write the tasks signs it off"
  elif [ "$rc" = 2 ] && [ -n "$redo" ]; then echo "$redo failed its last try and is dropped (source.dropped): v2 has 14 tasks in $out; next: the review mark and --sign-off NAME"
  elif [ "$rc" = 2 ]; then echo "a rewrite was dropped: read $out (source.dropped); the owner decides what replaces it"
  else echo "stopped (exit $rc); the same command resumes it"; fi
  echo "ledger: $KP_WORK/author-ledger.jsonl; log: $KP_LOGDIR/run.log"
  return "$rc"
}

main "$@"
