#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-pilot-v2-rerun.sh -- the keep-or-prune pilot rerun on baseline v2 (PAID, owner approved 2026-11-23: option A,
# cap 3,240 counted credits): context:k-orchestrator-shared at quick depth, with the FW-36 role line ("You orchestrate a
# team of specialist agents.") at the start of both arms of every unit task. Control prompts do not change.
#
#   bash $KONDUCTOR_WS/scripts/run-pilot-v2-rerun.sh --plan   # free: the gates and the calls by section, cached and new
#   bash $KONDUCTOR_WS/scripts/run-pilot-v2-rerun.sh          # PAID; safe under setsid nohup, the same command resumes
#
# Run id kp-pilot-3, its own ledger (v2-rerun-ledger.jsonl), and the saved calls of kp-pilot-2 copied in first (never
# overwriting), so the convention control (120 calls) and the dose ladder (120 calls) cost nothing and so do the 10
# kept tasks' checklists. Expected: 215 new calls, 3,225 counted, about 33 real.
# It refuses to start unless: (1) baseline v2 exists (reports/kp-pilot/unit-baselines-v2/.../baseline.json, not a
# draft) and is signed off; (2) Fable's review passed it: reports/kp-pilot-v2/fable-review-passed holds the line
# "tasks-sha256 <hash of the v2 tasks>" (reports/kp-pilot-v2/fable-review-brief.md says how), or the owner passes
# --skip-fable-review; (3) three judge families sit; (4) the controls are all cached; (5) the step fits its cap.
# The first paid run pins the feat/bench-pilot-nk head in reports/kp-pilot-v2/rerun-pinned-commit (logged); a --plan
# reads the head and pins nothing. Own checkout (konductor-plant/.worktrees/kp-v2-rerun); the pilot's checkout and pin
# are not touched. Holds the heavy lock while it spends.
# Env overrides: UNIT_CAP (default 3240; raise only with the owner's approval, 15 per killed call on a resume);
# KP_* as in kp-pilot-lib.sh; V2_BASELINES (the v2 baselines dir); V2_REVIEW_MARK (the review marker file).
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

RUN_ID=kp-pilot-3
FROM_RUN=kp-pilot-2
UNIT_CAP=${UNIT_CAP:-3240}
PIN_MARK="v2 rerun: role line (FW-36)"

# tasks_sha FILE: sha256 of the baseline's tasks (its batches), which a sign-off does not change.
tasks_sha() { node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(require("crypto").createHash("sha256").update(JSON.stringify(b.batches)).digest("hex"))' "$1"; }

main() {
  local self dry skip rc plan ledger pin rec mark want got
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  dry=0
  skip=0
  rc=0
  plan=""
  want=""
  got=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --plan|--dry-run) dry=1 ;;
      --skip-fable-review) skip=1 ;;
      -h|--help) sed -n '2,24p' "$0"; return 0 ;;
      *) echo "unknown argument: $1" >&2; return 64 ;;
    esac
    shift
  done
  case "$UNIT_CAP" in ''|*[!0-9]*) echo "UNIT_CAP must be a whole number" >&2; return 64 ;; esac
  export KP_WT_NAME=${KP_WT_NAME:-kp-v2-rerun}
  export KP_PIN_FILE=${KP_PIN_FILE:-$KONDUCTOR_WS/reports/kp-pilot-v2/rerun-pinned-commit}
  export KP_BASELINES=${V2_BASELINES:-$KONDUCTOR_WS/reports/kp-pilot/unit-baselines-v2}
  mark=${V2_REVIEW_MARK:-$KONDUCTOR_WS/reports/kp-pilot-v2/fable-review-passed}
  # shellcheck source=kp-pilot-lib.sh
  . "$self/kp-pilot-lib.sh"
  kp_setup "v2-rerun$([ "$dry" = 1 ] && echo -plan || true)"
  pin=$KP_PIN_FILE
  ledger=$KP_WORK/v2-rerun-ledger.jsonl
  rec=$KP_WORK/runs/$RUN_ID/stage-4/context-k-orchestrator-shared.json

  # --- gate 0: the v2 baseline and Fable's review, before any checkout or call ---
  [ -f "$KP_BASELINE" ] || kp_stop "no baseline v2 at $KP_BASELINE: run scripts/run-pilot-v2-rewrite.sh first$([ -f "${KP_BASELINE%.json}.draft.json" ] && echo " (only a draft exists: a rewrite was dropped)" || true)"
  want=$(tasks_sha "$KP_BASELINE")
  if [ "$skip" = 1 ]; then
    echo "gate 0, Fable review: SKIPPED by --skip-fable-review (the owner's call)"
  else
    got=$( [ -f "$mark" ] && sed -n 's/^tasks-sha256 \([0-9a-f]\{64\}\)$/\1/p' "$mark" | head -n 1 || true)
    [ -n "$got" ] || kp_stop "no Fable review mark at $mark: run the review in reports/kp-pilot-v2/fable-review-brief.md, or pass --skip-fable-review"
    [ "$got" = "$want" ] || kp_stop "the Fable review mark is for other tasks ($got), not this v2 ($want): review the current v2"
    echo "gate 0, Fable review passed these tasks: PASS"
  fi

  # The role-line code is on the branch head. A --plan reads the head and pins nothing; the first paid run pins it.
  if ! grep -qF "$PIN_MARK" "$pin.log" 2>/dev/null; then
    if [ "$dry" = 1 ]; then
      export KP_REF=${KP_REF:-origin/feat/bench-pilot-nk}
      echo "plan: reading the feat/bench-pilot-nk head; the paid run pins it"
    else
      kp_repin "$PIN_MARK"
    fi
  fi
  kp_refresh
  grep -q "'role-line'" "$KP_WT/bench/runner/lib/cli-flags.js" || kp_stop "the commit in $KP_WT has no --role-line; delete $pin and its log to pin a newer head"
  [ "$dry" = 1 ] || kp_creds
  # The saved calls of the last run: controls and kept tasks are read back, never paid again. Judgments are made again
  # from the saved judge replies, so none is copied.
  if [ -d "$KP_WORK/runs/$FROM_RUN/calls" ]; then
    mkdir -p "$KP_WORK/runs/$RUN_ID"
    cp -a -n "$KP_WORK/runs/$FROM_RUN/calls" "$KP_WORK/runs/$RUN_ID/" 2>/dev/null || cp -a --update=none "$KP_WORK/runs/$FROM_RUN/calls" "$KP_WORK/runs/$RUN_ID/"
    echo "cache: the saved calls of $FROM_RUN copied into $RUN_ID (no file overwritten)"
  else
    echo "cache: no $KP_WORK/runs/$FROM_RUN/calls, so every call is new (gate 4 fails)"
  fi
  local -a vars=(KP_PILOT_WORK="$KP_WORK" KP_KIRO_BIN="$KP_BIN" KP_BASELINES="$KP_BASE_DIR" KP_PILOT_RUN="$RUN_ID" KP_PILOT_LEDGER="$ledger" KP_ROLE_LINE=1)

  # --- gates 1 to 5, from the run's own dry run (no call made) ---
  plan=$(env "${vars[@]}" bash "$KP_WT/bench/cap/pilot/run-pilot.sh" --dry-run --cap "$UNIT_CAP" < /dev/null) || kp_stop "the run's dry run failed; no call was made"
  printf '%s\n' "$plan"
  local signed=FAIL panel=FAIL cached=FAIL fits=FAIL role=FAIL
  if printf '%s\n' "$plan" | grep -q '^baseline fresh, signed off by ' && ! printf '%s\n' "$plan" | grep -q 'signed off by nobody yet'; then signed=PASS; fi
  if printf '%s\n' "$plan" | grep -q 'judges qwen3-coder-next, gpt-5.6-luna, grok-4.7$'; then panel=PASS; fi
  if printf '%s\n' "$plan" | grep -q '^  convention control: .* 0 new' && printf '%s\n' "$plan" | grep -q '^  dose ladder: .* 0 new'; then cached=PASS; fi
  if printf '%s\n' "$plan" | grep -q '^  this step: .*: fits$'; then fits=PASS; fi
  if printf '%s\n' "$plan" | grep -q '^  role line for both arms of each unit task: '; then role=PASS; fi
  echo "gate 1, baseline v2 fresh and signed off: $signed"
  echo "gate 2, three judge families seated:      $panel"
  echo "gate 3, role line on both unit arms:      $role"
  echo "gate 4, controls all cached:              $cached"
  echo "gate 5, this step fits its cap:           $fits"
  if [ "$signed$panel$role$cached$fits" != PASSPASSPASSPASSPASS ] || printf '%s\n' "$plan" | grep -q '^would stop before the first call'; then
    kp_stop "not started: a gate failed (see the lines above); no call was made"
  fi
  if [ "$dry" = 1 ]; then
    echo "plan done; the paid command is: bash $KONDUCTOR_WS/scripts/run-pilot-v2-rerun.sh$([ "$skip" = 1 ] && echo ' --skip-fable-review' || true)"
    return 0
  fi
  kp_heavy_lock
  echo "PAID: the pilot rerun on baseline v2, cap $UNIT_CAP counted credits"
  env "${vars[@]}" bash "$KP_WT/bench/cap/pilot/run-pilot.sh" --cap "$UNIT_CAP" < /dev/null || rc=$?
  echo "ledger: $ledger; log: $KP_LOGDIR/run.log"
  [ "$rc" = 0 ] || { echo "the run stopped (exit $rc); the same command resumes it (a killed call needs UNIT_CAP 15 higher)"; return "$rc"; }
  cp "$rec" "$KP_LOGDIR/record.json"
  cp "${rec%.json}.md" "$KP_LOGDIR/record.md"
  echo "done: the record is $rec (copy in $KP_LOGDIR); next: a person reads it and signs the verdict off"
}

main "$@"
