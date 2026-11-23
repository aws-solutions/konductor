#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# run-wave0-fix.sh -- ONE command for the owner to finish wave 0 after the overnight run left 7 budget-skipped runs
# and the arm trial dead. In order: (1) FILL the budget-skipped runs with `bench run --resume` under a ceiling that
# cannot skip and a raised per-run limit (no budget skips); (2) the arm real-model trial (Strands/Bedrock, USD 8 cap);
# (3) plant-report for the wave 0 table. It reuses the fixed arm_trial, ledger and guards from run-physical-ai-wave0.sh.
#
#   bash scripts/run-wave0-fix.sh            # PAID: fills ~7 runs (~3 real credits) + the arm trial (USD 8 cap)
#   bash scripts/run-wave0-fix.sh --dry-run  # FREE: stub bench, no lock/timeout/spend; exercises the orchestration
#
# Guards (all from the shared wrapper): heavy lock, hard timeout, pinned-keys restore on exit, a ledger headroom check
# before each paid step. Overrides: PLANT_FILL_BUDGET (default 65 credits), PLANT_FILL_RUNLIM (default 3), plus every
# override run-physical-ai-wave0.sh takes (PLANT_CHECKOUT, PLANT_VENV, ARM_*, PLANT_BENCH_CMD, ...).
set -euo pipefail

DRY=0
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; -h|--help) sed -n '2,20p' "$0"; exit 0 ;; *) echo "unknown arg $a" >&2; exit 64 ;; esac; done

FILL_BUDGET=${PLANT_FILL_BUDGET:-65}       # > 40.89 already spent, with headroom for the 7 fills; keeps the 360 counted cap
FILL_RUNLIM=${PLANT_FILL_RUNLIM:-3}        # was 2; raised so the 2.0x p1 runs are not flagged "over the run limit"

# Hard timeout: re-exec the whole real run under `timeout` so a stuck fill/arm can never hold the heavy lock forever.
if [ "$DRY" = 0 ] && [ -z "${WAVE0FIX_TIMED:-}" ]; then
  exec env WAVE0FIX_TIMED=1 timeout --signal=TERM --kill-after=120 "${WAVE0FIX_TIMEOUT:-120m}" bash "$0" "$@"
fi

# Reuse the fixed wrapper as a library: its vars (R, CHECKOUT, VENV, FFI, REPORTS, LEDGER, TS, BJ, HEAVY_LOCK),
# say(), the ledger helpers, ensure_paid_release and the FIXED arm_trial (Strands creds + ledger-on-success).
SELFDIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export WAVE0_LIB=1
# shellcheck disable=SC1090
source "$SELFDIR/run-physical-ai-wave0.sh"

FIXLOG="$REPORTS/run-wave0-fix-$TS"; mkdir -p "$FIXLOG"
OUT="$R/out-wave0"; REL="$R/release"

# Pinned-keys restore on ANY exit (incl. TERM/timeout), belt-and-suspenders: the fill/arm paths should not touch the
# real pin, but if anything does, leave it as found.
PINNED="$CHECKOUT/bench/runner/lib/plant/pinned-keys.json"; PIN_BAK="$FIXLOG/pinned-keys.backup.json"
if [ -f "$PINNED" ]; then
  cp -f "$PINNED" "$PIN_BAK"
  trap 'cp -f "$PIN_BAK" "$PINNED" 2>/dev/null || true' EXIT
  trap 'cp -f "$PIN_BAK" "$PINNED" 2>/dev/null || true; exit 143' TERM INT
fi

# The heavy lock for the whole paid run (released when fd 9 closes). Dry skips it.
if [ "$DRY" = 0 ]; then
  exec 9>"$HEAVY_LOCK"; say "waiting for the heavy lock $HEAVY_LOCK ..."; flock -x 9; say "heavy lock held"
fi

creds_of() { "$VENV/bin/python" -c "import json;print(round(json.load(open('$1'))['totalCredits'],3))" 2>/dev/null || echo 0; }

# ---- step 1: fill the budget-skipped runs (resume with a ceiling that cannot skip) ----
fill_skipped() {
  if [ ! -f "$OUT/run-config.json" ]; then say "fill SKIPPED: no earlier wave 0 run at $OUT"; return 0; fi
  local sha tasks before
  sha=$(cat "$R/release.sha256" 2>/dev/null || sha256sum "$REL/manifest.json" 2>/dev/null | cut -d' ' -f1 || echo '')
  tasks=$("$VENV/bin/python" -c "import json;print(','.join(json.load(open('$OUT/run-config.json'))['taskIds']))" 2>/dev/null || echo '')
  before=$(creds_of "$OUT/summary.json")
  ledger_check "wave0 fill"
  say "fill: resume $OUT, budget $FILL_BUDGET, per-run limit $FILL_RUNLIM (was $before credits)"
  local run=(run --resume --out "$OUT" --suite lite --arms plant-policy,plant-allowall
    --plant-release "$REL" --plant-release-sha256 "$sha" --extra-tasks "$REL/tasks" --hide "$CHECKOUT"
    --python "$VENV/bin/python" --plant-python "$VENV/bin/python" --agent-engine v3 --parallel 1
    --isolate none --allow-unisolated --budget-credits "$FILL_BUDGET" --run-credit-limit "$FILL_RUNLIM")
  [ -n "$tasks" ] && run+=(--tasks "$tasks")
  local rc=0
  set +e
  LD_LIBRARY_PATH="$FFI" nice -n 10 "${BJ[@]}" "${run[@]}" 2>&1 | tee "$FIXLOG/fill.log"
  rc=${PIPESTATUS[0]}
  set -e
  if [ "$rc" != 0 ]; then say "fill FAILED (exit $rc); see $FIXLOG/fill.log"; return 1; fi
  local left after delta
  left=$(grep -rl '"budget_skipped"' "$OUT"/plant-*/*/*/result.json 2>/dev/null | wc -l | tr -d ' ')
  after=$(creds_of "$OUT/summary.json")
  delta=$(awk -v a="$after" -v b="$before" 'BEGIN{d=a-b; if(d<0)d=0; printf "%.3f", d}')
  [ "$DRY" = 1 ] || ledger_add "wave0-fill" "$delta"
  say "fill done: $before -> $after credits (+$delta); budget_skipped cells left: ${left:-?}"
  [ "${left:-0}" = 0 ] || { say "WARNING: $left cell(s) still budget_skipped -- raise PLANT_FILL_BUDGET and rerun"; return 1; }
  return 0
}

RC=0
say "run-wave0-fix ($([ "$DRY" = 1 ] && echo DRY || echo PAID)): fill skipped -> arm trial -> plant-report; logs $FIXLOG"
fill_skipped || RC=1
arm_trial || RC=1
say "plant-report -> $OUT-report"
if "${BJ[@]}" plant-report --run "$OUT" --release "$REL" --out "$OUT-report" > "$FIXLOG/plant-report.log" 2>&1; then
  say "wave 0 table: $OUT-report/plant-report.md"
else
  say "plant-report failed; see $FIXLOG/plant-report.log"; RC=1
fi
say "DONE (rc=$RC). Logs: $FIXLOG; credits so far: $(ledger_used)/$CAP"
exit "$RC"
