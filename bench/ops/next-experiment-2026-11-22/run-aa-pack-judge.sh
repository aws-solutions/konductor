#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# FW-38 judge pass of the A/A run (run-aa-pack.sh). Paid in USD, no credits. Not run by the agent that wrote it.
#
#   bash run-aa-pack-judge.sh --plan    free: judge calls and estimated USD per set; no model call
#   bash run-aa-pack-judge.sh           judge both sets in one pass, then print the A/A floor
#
# One pass: the same panel, backend, mode and judge bench for set a and set b, run back to back, so the A/A gap holds
# no judge drift (forced-skills review claim 5); compare refuses two sets judged in different passes. Panel:
# gpt-5.6-luna, deepseek-3.2, qwen3-coder-next: three families, none Claude (the agent is claude-sonnet-5.5). Same judge
# bench as the LITE judge pass (the LITE judge worktree at the frozen bench commit 69149846), so t6 keeps its frozen v5
# rubric. Cap: USD 2 in all (CAP_USD, at most 2). 48 runs x 3 judges, about USD 1.2. Before each set, spend so far plus
# one run's worst case (3 judges x 2 calls x USD 0.05) must stay under the cap, and the bench's own USD guard
# (--budget-usd, what is left of the cap) checks before every call. Each set is judged in a copy under
# judge-aa-pack/runs/, so the raw runs stay as they ran. Rerun to resume: judged sets are skipped, finished calls cached.
# Then `bench compare --base set-a --head set-b --aa vanilla` from the ops checkout (the frozen bench predates it)
# prints the A/A half-width on success, check pass and rubric: the floor every later verdict quotes (docs/scoring.md).
# shortcut: this is run-forced-small-judge.sh over two sets; the shared steps move to one lib with FW-22.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

WS=$KONDUCTOR_WS
HERE=${HERE:-$WS/reports/next-experiment-2026-11-22}
OUT=$HERE/runs-aa-pack
J=$HERE/judge-aa-pack
B=${JUDGE_BENCH:-$WS/reports/lite-run-2026-11-21/judge/bench}   # LITE judge worktree, read only here
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203
H=$WS/scripts/lite-helper.js
OPS=${KONDUCTOR_OPS:-$WS/worktrees/ops}                          # has compare --aa; the frozen bench predates it
CAP_USD=${CAP_USD:-2}
PER_RUN_WORST=0.3
PROFILE=${AWS_PROFILE_NAME:-default}
PANEL=gpt-5.6-luna,deepseek-3.2,qwen3-coder-next
BATCHES='t8 t5 t6 t2 t7 t1'
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }
PLAN_ONLY=0
case "${1:-}" in --plan) PLAN_ONLY=1 ;; "") ;; *) echo "usage: bash run-aa-pack-judge.sh [--plan]" >&2; exit 64 ;; esac

# Never a Claude judge for a Claude agent.
case ",$PANEL," in *claude*|*sonnet*|*opus*|*haiku*) stop "the panel holds a Claude model: $PANEL" ;; esac
CAP_OK=$(awk -v c="$CAP_USD" 'BEGIN { print (c > 0 && c <= 2) ? "yes" : "no" }')
[ "$CAP_OK" = yes ] || stop "CAP_USD $CAP_USD is outside the USD 2 the plan sets for FW-38"
[ -d "$B" ] || stop "$B is missing (the LITE judge worktree)"
[ "$(git -C "$B" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$B is not at $BENCH_SHA"
[ -z "$(git -C "$B" status --porcelain)" ] || stop "$B has local changes"
mkdir -p "$J/packs" "$J/runs"

SETS=$(cd "$OUT" 2>/dev/null && ls -d a.done b.done 2>/dev/null | sed 's/[.]done$//' | sort)
[ -n "$SETS" ] || stop "no finished set under $OUT: run run-aa-pack.sh --go first"
cd "$B" || exit 1
EXTRA=''
for batch in $BATCHES; do
  [ -d "$J/packs/$batch" ] || git -C "$B" archive "$BENCH_SHA" "bench/scenarios/$batch" | tar -x -C "$J/packs" --strip-components=2 || stop "pack export $batch"
  EXTRA=${EXTRA:+$EXTRA,}$J/packs/$batch
done

# A task with no judge items stays code-only: a judge can only fail it, so it is left out of the judge copy.
drop_code_only() {
  local copy=$1 batch c arm
  for batch in $BATCHES; do
    for c in $(node "$H" code-only "$B" "$J/packs/$batch"); do
      for arm in "$copy"/*/; do [ -d "$arm$c" ] && rm -r -- "$arm$c"; done
      grep -qx "$c" "$J/code-only.txt" 2>/dev/null || echo "$c" >> "$J/code-only.txt"
      say "$c has no judge items, code-only"
    done
  done
}

for set in $SETS; do
  C=$J/runs/$set
  if [ "$PLAN_ONLY" = 1 ]; then
    say "== set $set"
    node bench/runner/bench.js judge --run "$OUT/$set" --extra-tasks "$EXTRA" --judges "$PANEL" --mode rubric \
      --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$CAP_USD" --concurrency 1 --plan 2>&1 | tail -n 12
    continue
  fi
  [ -e "$C.done" ] && { say "set $set: judged, skipped"; continue; }
  if [ ! -d "$C" ]; then
    cp -a -- "$OUT/$set" "$C" || stop "copy set $set"
    drop_code_only "$C"
  fi
  aws sts get-caller-identity --profile "$PROFILE" > /dev/null 2>&1 || stop "AWS credentials for profile $PROFILE expired before set $set"
  spent=$(node "$H" judge-spent "$J/runs")
  left=$(awk -v s="$spent" -v c="$CAP_USD" -v w="$PER_RUN_WORST" 'BEGIN { if (s + w > c) print "STOP"; else printf "%.4f", c - s }')
  [ "$left" = STOP ] && stop "spent USD $spent of the USD $CAP_USD cap before set $set"
  say "set $set: judging, spent USD $spent, guard USD $left"
  nice -n 19 node bench/runner/bench.js judge --run "$C" --extra-tasks "$EXTRA" --judges "$PANEL" --mode rubric \
    --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$left" --concurrency 1 >> "$C-judge.log" 2>&1
  rc=$?
  say "set $set: exit $rc, $(grep '^judged' "$C-judge.log" | tail -n 1)"
  [ "$rc" = 0 ] || stop "judge exit $rc on set $set (see $C-judge.log); rerun to resume"
  touch "$C.done"
done
[ "$PLAN_ONLY" = 1 ] && exit 0
[ -e "$J/runs/a.done" ] && [ -e "$J/runs/b.done" ] || stop "both sets must be judged before the floor"

say "judge spend USD $(node "$H" judge-spent "$J/runs") of $CAP_USD"
[ -f "$OPS/bench/report/compare-aa.js" ] || stop "$OPS has no compare --aa: move the ops checkout to the branch head"
node "$OPS/bench/runner/bench.js" compare --base "$J/runs/a" --head "$J/runs/b" --aa vanilla --bench-dir "$B/bench" > "$J/aa-floor.txt" 2>&1
rc=$?
cat "$J/aa-floor.txt"
[ "$rc" = 0 ] || say "compare exited $rc (see $J/aa-floor.txt)"
say "A/A floor: $J/aa-floor.txt; quote its half-width and the date in docs/scoring.md"
