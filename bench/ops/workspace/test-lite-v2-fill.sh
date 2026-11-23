#!/usr/bin/env bash
# test-lite-v2-fill.sh -- free test of run-lite-konductor-v2.sh's budget and fill rules. No model call, no bench run.
# It sources v2 as a library (LITE_LIB=1), stubs bench.js, the spend reader and the host checks, and works in a temp
# ROOT, so the real run folder, worktrees/pilot and the pin are never read or written.
#
#   bash scripts/test-lite-v2-fill.sh      # prints PASS/FAIL per check; exit 0 only if all pass
set -uo pipefail

SELF=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
T=$(mktemp -d "${TMPDIR:-/tmp}/lite-v2-test.XXXXXX")
trap 'rm -rf -- "$T"' EXIT
fail=0
ok()  { printf 'PASS: %s\n' "$*"; }
bad() { printf 'FAIL: %s\n' "$*"; fail=1; }

export ROOT="$T/root" F="$SELF/lite-fill.js" LITE_LIB=1 KBIN=/bin/true R="$T/no-bench"
# shellcheck disable=SC1091
source "$SELF/run-lite-konductor-v2.sh"
set +e

# ---- stubs
SPENT=$T/spent.tsv                         # "<path> <credits>" lines; missing path = 0
spent() { awk -v p="$1" '$1 == p { print $2; f = 1 } END { if (!f) print 0 }' "$SPENT"; }
set_spent() { : > "$SPENT"; while [ $# -gt 1 ]; do echo "$1 $2" >> "$SPENT"; shift 2; done; }
wait_quiet() { :; }
base_args() { printf '%s\n' run --tasks "x-$1"; }
q() { echo 23; }
table_of() { echo '| task | arm | rep | handEdited | singleFamily | score | time s | credits | flags | loads |' > "$2"; node "$F" table "$2" "$1" > /dev/null; }
put() { # put DIR ARM TASK STATUS
  mkdir -p "$1/$2/$3/1"
  printf '{"armId":"%s","taskId":"%s","replicate":1,"status":"%s","error":%s}\n' "$2" "$3" "$4" \
    "$([ "$4" = budget_skipped ] && echo '"budget headroom: stub"' || echo null)" > "$1/$2/$3/1/result.json"
}
CALLS=$T/calls
bench() { # stub bench.js: pass 1 leaves vanilla skipped; --resume fills it unless STUB_MODE=stuck
  local out="" resume=0 budget="" a prev=""
  for a in "$@"; do
    [ "$prev" = --out ] && out=$a; [ "$prev" = --budget-credits ] && budget=$a
    [ "$a" = --resume ] && resume=1; prev=$a
  done
  echo "budget=$budget resume=$resume" >> "$CALLS"
  mkdir -p "$out"; : > "$out/run-config.json"
  put "$out" konductor task-a success
  if [ "$resume" = 1 ] && [ "${STUB_MODE:-fill}" = fill ]; then put "$out" vanilla task-a success
  else put "$out" vanilla task-a budget_skipped; fi
  return 0
}
reset() { rm -rf -- "$ROOT"; mkdir -p "$ROOT/runs/r1" "$ROOT/tables" "$ROOT/incomplete"; : > "$CALLS"; STOPPED=""; }

# ---- 1. a skipped run is filled by a second pass; budget is the stage A room, not a 1.5x batch ceiling
reset; set_spent "$ROOT/runs" 100 "$ROOT/runs/r1" 100
run_batch 1 t1
[ -e "$ROOT/runs/r1/t1.done" ] && ok "fill: batch marked done after the fill pass" || bad "fill: no .done (STOPPED=$STOPPED)"
[ "$(wc -l < "$CALLS")" = 2 ] && ok "fill: bench called twice" || bad "fill: bench called $(wc -l < "$CALLS") times"
grep -q 'budget=325 resume=0' "$CALLS" && ok "fill: pass 1 budget 325 = 450 - 100 - 25" || bad "fill: budgets $(tr '\n' ' ' < "$CALLS")"
sed -n 2p "$CALLS" | grep -q 'resume=1' && ok "fill: pass 2 used --resume" || bad "fill: pass 2 did not resume"
[ "$(node "$F" skipped "$ROOT/runs/r1/t1")" = 0 ] && ok "fill: no budget_skipped run left" || bad "fill: skipped runs remain"

# ---- 2. a skip that will not fill: batch not marked done, run stops cleanly
reset; STUB_MODE=stuck; set_spent "$ROOT/runs" 100 "$ROOT/runs/r1" 100
run_batch 1 t1; STUB_MODE=fill
[ ! -e "$ROOT/runs/r1/t1.done" ] && ok "stuck: batch left open for --resume" || bad "stuck: batch marked done with a skipped run"
case "$STOPPED" in *"budget_skipped"*) ok "stuck: run stops with a reason";; *) bad "stuck: STOPPED='$STOPPED'";; esac
grep -q 'budget_skipped' "$ROOT/tables/r1-t1.md" && ok "table: skipped run shown as a budget_skipped row" || bad "table: no budget_skipped row"

# ---- 3. stage A room gone: no bench call
reset; set_spent "$ROOT/runs" 430 "$ROOT/runs/r1" 430
run_batch 1 t2
[ ! -s "$CALLS" ] && ok "cap: no run starts when stage A has no room" || bad "cap: bench was called"
case "$STOPPED" in "ceiling reached"*) ok "cap: stops with 'ceiling reached'";; *) bad "cap: STOPPED='$STOPPED'";; esac

# ---- 4. replicate 2 uses only the total cap
reset; mkdir -p "$ROOT/runs/r2"; set_spent "$ROOT/runs" 500 "$ROOT/runs/r1" 440
run_batch 2 t1
grep -q 'budget=775 resume=0' "$CALLS" && ok "r2: budget 775 = 1300 - 500 - 25" || bad "r2: budgets $(tr '\n' ' ' < "$CALLS")"

# ---- 4b. a resumed batch: spend already in it is not added back (bench's budget counts new spend only)
reset; set_spent "$ROOT/runs" 100 "$ROOT/runs/r1" 100 "$ROOT/runs/r1/t3" 20
run_batch 1 t3
grep -q 'budget=325 resume=0' "$CALLS" && ok "resumed: budget 325, not 345" || bad "resumed: budgets $(tr '\n' ' ' < "$CALLS")"

# ---- 5. fill step reopens only finished batches with skipped runs, by rename
reset; mkdir -p "$ROOT/runs/r2"
put "$ROOT/runs/r1/t1" vanilla task-a budget_skipped; touch "$ROOT/runs/r1/t1.done"
put "$ROOT/runs/r1/t2" vanilla task-b success;        touch "$ROOT/runs/r1/t2.done"
put "$ROOT/runs/r2/t12" vanilla task-c budget_skipped; touch "$ROOT/runs/r2/t12.done"
node "$F" reopen "$ROOT" --dry > "$T/dry.txt"
[ -e "$ROOT/runs/r1/t1.done" ] && grep -q 'would reopen r1 t1' "$T/dry.txt" && ok "reopen --dry: lists, moves nothing" || bad "reopen --dry"
node "$F" reopen "$ROOT" > /dev/null
[ ! -e "$ROOT/runs/r1/t1.done" ] && [ ! -e "$ROOT/runs/r2/t12.done" ] && ok "reopen: r1 t1 and r2 t12 reopened" || bad "reopen: markers still there"
[ -e "$ROOT/runs/r1/t2.done" ] && ok "reopen: clean batch r1 t2 kept done" || bad "reopen: clean batch reopened"
[ "$(ls "$ROOT/incomplete" | grep -c '[.]done[.]')" = 2 ] && ok "reopen: 2 markers kept in incomplete/" || bad "reopen: markers not kept"
[ -f "$ROOT/runs/r1/t1/vanilla/task-a/1/result.json" ] && ok "reopen: run results untouched" || bad "reopen: results lost"

echo "----"
[ "$fail" = 0 ] && { echo "ALL PASS"; exit 0; } || { echo "SOME FAILED"; exit 1; }
