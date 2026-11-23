#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-pilot-rerun.sh -- keep-or-prune pilot, step 3 again, after pilot 1 gave NO DATA (the convention control failed,
# reports/pilot-diagnosis-2026-11-23.md). Two parts, each a separate owner decision:
#
#   bash $KONDUCTOR_WS/scripts/run-pilot-rerun.sh --dry-run         # free: gates and plan
#   bash $KONDUCTOR_WS/scripts/run-pilot-rerun.sh                   # PAID: controls only, cap 1,800
#   bash $KONDUCTOR_WS/scripts/run-pilot-rerun.sh --unit --dry-run  # free: the unit step's plan
#   bash $KONDUCTOR_WS/scripts/run-pilot-rerun.sh --unit            # PAID: the unit, cap 3,375
#
# Run id kp-pilot-2, so the kp-pilot-1 record stays. The first use copies kp-pilot-1's saved calls and its dose-ladder
# judgments into kp-pilot-2 (never overwriting), so the ladder (120 calls, 192 judgments) costs nothing. Its old
# convention-control judgments are not copied: they judged the old prompts. The controls part runs on a fresh ledger
# (rerun-ledger.jsonl), the unit part on another (unit-ledger.jsonl), so each cap counts from 0.
# The controls part then prints each control's checks and stops. The unit part refuses to start unless both controls
# passed. The first paid controls run moves the pin to the feat/bench-pilot-nk head (logged); every later run uses
# that pin. Own worktree (kp-pilot-rerun). Holds the heavy lock while it spends. Env overrides: scripts/kp-pilot-lib.sh.
set -euo pipefail
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

RUN_ID=kp-pilot-2
OLD_RUN=kp-pilot-1
CONTROLS_CAP=${CONTROLS_CAP:-1800}   # override only with the owner's approval
UNIT_CAP=${UNIT_CAP:-3375}   # a resume after a killed call needs 15 more per killed call
FIX_MARK="rerun: convention control fix"

# copy_cache: kp-pilot-1's saved calls and ladder judgments into kp-pilot-2, never overwriting a file.
copy_cache() {
  local old new
  old=$KP_WORK/runs/$OLD_RUN
  new=$KP_WORK/runs/$RUN_ID
  [ -d "$old/calls" ] || { echo "no $old/calls: nothing to reuse, every call is new"; return 0; }
  mkdir -p "$new/judgments"
  cp -a -n "$old/calls" "$new/" 2>/dev/null || cp -a --update=none "$old/calls" "$new/"
  [ -d "$old/judgments/ladder" ] && { cp -a -n "$old/judgments/ladder" "$new/judgments/" 2>/dev/null || cp -a --update=none "$old/judgments/ladder" "$new/judgments/"; }
  echo "cache: $old calls and ladder judgments copied into $new (no file overwritten)"
}

# print_controls FILE: each control's status and its checks with their numbers, from a stage record.
print_controls() {
  local file=$1
  node -e '
    const r = require(process.argv[1]);
    const c = r.quick && r.quick.controls;
    if (!c || !(c.results || []).length) { console.log("controls: none ran"); process.exit(1); }
    for (const x of c.results) {
      console.log(`${x.control}: ${x.status}`);
      for (const k of x.checks || []) console.log(`  ${k.ok ? "pass" : "FAIL"}  ${k.name}: ${k.detail}`);
    }
    process.exit(c.results.every((x) => x.status === "PASS") ? 0 : 2);
  ' "$file"
}

main() {
  local self dry unit rc plan cap ledger pin rec part
  self=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  dry=0
  unit=0
  rc=0
  plan=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) dry=1 ;;
      --unit) unit=1 ;;
      -h|--help) sed -n '2,20p' "$0"; return 0 ;;
      *) echo "unknown argument: $1" >&2; return 64 ;;
    esac
    shift
  done
  export KP_WT_NAME=${KP_WT_NAME:-kp-pilot-rerun}
  # shellcheck source=kp-pilot-lib.sh
  . "$self/kp-pilot-lib.sh"
  part=$([ "$unit" = 1 ] && echo unit || echo controls)
  kp_setup "rerun-$part$([ "$dry" = 1 ] && echo -dry || true)"
  pin=${KP_PIN_FILE:-$KP_W/reports/kp-pilot/pinned-commit}
  # The fix is on the branch head, not on the old pin. A dry run reads the head and moves nothing; the first paid
  # controls run moves the pin there once, so a resume or the unit step runs the same code.
  if ! grep -qF "$FIX_MARK" "$pin.log" 2>/dev/null; then
    if [ "$dry" = 1 ]; then
      export KP_REF=${KP_REF:-origin/feat/bench-pilot-nk}
      echo "dry run: reading the feat/bench-pilot-nk head; the paid controls run pins it"
    elif [ "$unit" = 1 ]; then
      kp_stop "run the controls part first (bash $KONDUCTOR_WS/scripts/run-pilot-rerun.sh); it pins the fixed commit"
    else
      kp_repin "$FIX_MARK"
    fi
  fi
  kp_refresh
  grep -q CONTROL_AS_GIVEN "$KP_WT/bench/cap/frozen.js" || kp_stop "the commit in $KP_WT does not have the control fix"
  [ "$dry" = 1 ] || kp_creds
  [ -f "$KP_BASELINE" ] || kp_stop "no baseline at $KP_BASELINE"
  copy_cache
  rec=$KP_WORK/runs/$RUN_ID/stage-4/context-k-orchestrator-shared.json
  if [ "$unit" = 1 ]; then
    cap=$UNIT_CAP
    ledger=$KP_WORK/unit-ledger.jsonl
    [ -f "$rec" ] || kp_stop "no controls record at $rec: run the controls part first"
    echo "the controls part's result:"
    print_controls "$rec" || kp_stop "not started: a control did not pass (see above), so the unit step would give NO DATA"
  else
    cap=$CONTROLS_CAP
    ledger=$KP_WORK/rerun-ledger.jsonl
  fi
  local -a vars=(KP_PILOT_WORK="$KP_WORK" KP_KIRO_BIN="$KP_BIN" KP_BASELINES="$KP_BASE_DIR" KP_PILOT_RUN="$RUN_ID" KP_PILOT_LEDGER="$ledger")
  [ "$unit" = 1 ] || vars+=(KP_CONTROLS_ONLY=1)

  # --- gates, from the run's own dry run (no call made) ---
  plan=$(env "${vars[@]}" bash "$KP_WT/bench/cap/pilot/run-pilot.sh" --dry-run --cap "$cap" < /dev/null) || kp_stop "the run's dry run failed; no call was made"
  printf '%s\n' "$plan"
  local signed=FAIL panel=FAIL controls=FAIL fits=FAIL
  if printf '%s\n' "$plan" | grep -q '^baseline fresh, signed off by ' && ! printf '%s\n' "$plan" | grep -q 'signed off by nobody yet'; then signed=PASS; fi
  if printf '%s\n' "$plan" | grep -q 'judges qwen3-coder-next, gpt-5.6-luna, grok-4.7$'; then panel=PASS; fi
  if printf '%s\n' "$plan" | grep -q '^controls loaded: '; then controls=PASS; fi
  if printf '%s\n' "$plan" | grep -q '^  this step: .*: fits$'; then fits=PASS; fi
  echo "gate 1, baseline fresh and signed off: $signed"
  echo "gate 2, three judge families seated:   $panel"
  echo "gate 3, controls loaded:               $controls"
  echo "gate 4, this step fits its cap:        $fits"
  if [ "$signed$panel$controls$fits" != PASSPASSPASSPASS ] || printf '%s\n' "$plan" | grep -q '^would stop before the first call'; then
    kp_stop "not started: a gate failed (see the lines above); no call was made"
  fi
  if [ "$dry" = 1 ]; then
    echo "dry run done; the paid command is: bash $KONDUCTOR_WS/scripts/run-pilot-rerun.sh$([ "$unit" = 1 ] && echo ' --unit' || true)"
    return 0
  fi
  kp_heavy_lock
  echo "PAID: the pilot rerun, $part part, cap $cap counted credits"
  env "${vars[@]}" bash "$KP_WT/bench/cap/pilot/run-pilot.sh" --cap "$cap" < /dev/null || rc=$?
  echo "ledger: $ledger; log: $KP_LOGDIR/run.log"
  [ "$rc" = 0 ] || { echo "the run stopped (exit $rc); the same command resumes it"; return "$rc"; }
  cp "$rec" "$KP_LOGDIR/record-$part.json"
  cp "${rec%.json}.md" "$KP_LOGDIR/record-$part.md"
  echo "done: the record is $rec (copy in $KP_LOGDIR)"
  if [ "$unit" = 1 ]; then return 0; fi
  echo "the controls:"
  if print_controls "$rec"; then
    echo "both controls passed. STOP here: the unit step is the owner's decision (225 calls, at most 3,375 counted):"
    echo "  bash $KONDUCTOR_WS/scripts/run-pilot-rerun.sh --unit --dry-run"
    echo "  bash $KONDUCTOR_WS/scripts/run-pilot-rerun.sh --unit"
  else
    echo "a control did not pass, so the unit step would give NO DATA; do not run it. Send the record above for a diagnosis."
  fi
}

main "$@"
