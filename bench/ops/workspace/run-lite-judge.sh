#!/usr/bin/env bash
# Judge pass of the LITE konductor-vs-plain run, after run-lite-konductor.sh. For the judge worker; paid (USD).
#
#   bash run-lite-judge.sh --plan    free: calls and estimated USD per batch and replicate; no model call
#   bash run-lite-judge.sh           judge every finished unit, then write the report
#
# Panel: gpt-5.6-luna, deepseek-3.2, qwen3-coder-next (three non-Claude families; the agent is Claude), rubric mode,
# opencode backend on Bedrock, one call at a time. The paraphrase quote rule is the bench default, and the D-149 re-ask
# (one more call for a reply that fails every expert item blank) is built in.
# Cap: USD 3 in all (CAP_USD). Before each unit, spend so far plus one run's worst case (3 judges x 2 calls x USD 0.05)
# must stay under the cap, and the bench's own USD guard (--budget-usd, what is left of the cap) checks before every call.
# Each unit is judged in a copy under judge/runs/, so the raw runs stay as they ran. The task packs are exported at the
# bench commit the runs used (plan.json), so the judges read what the agent saw. Rerun to resume: finished units are
# skipped and finished calls are cached.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

WS=$KONDUCTOR_WS
PILOT=$WS/worktrees/pilot
ROOT=$WS/reports/lite-run-2026-11-21
J=$ROOT/judge
H=$WS/scripts/lite-helper.js
CAP_USD=${CAP_USD:-3}
PER_RUN_WORST=0.3
PROFILE=${AWS_PROFILE_NAME:-default}
PANEL=gpt-5.6-luna,deepseek-3.2,qwen3-coder-next
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }
PLAN_ONLY=0; [ "${1:-}" = --plan ] && PLAN_ONLY=1

[ -s "$ROOT/plan.json" ] || stop "no $ROOT/plan.json: run run-lite-konductor.sh first"
BENCH_SHA=$(node -p 'require(process.argv[1]).benchSha' "$ROOT/plan.json")
# The judge runs bench.js from a detached worktree at the same bench commit; the pilot pin is never moved here.
B=$J/bench
[ -d "$B" ] || git -C "$PILOT" worktree add -q --detach "$B" "$BENCH_SHA" || stop "cannot add a judge worktree at $BENCH_SHA"
[ "$(git -C "$B" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$B is not at $BENCH_SHA"
mkdir -p "$J/packs" "$J/runs"

UNITS=$(ls -d "$ROOT"/runs/r*/t* 2>/dev/null | grep -v '[.]\(done\|log\)$' | sort)
[ -n "$UNITS" ] || stop "no run units under $ROOT/runs"
cd "$B" || exit 1
JUDGED=()
for U in $UNITS; do
  b=$(basename "$U"); rep=$(basename "$(dirname "$U")")
  [ -e "$U.done" ] || { say "$rep $b: run not finished, left out"; continue; }
  [ -d "$J/packs/$b" ] || git -C "$B" archive "$BENCH_SHA" "bench/scenarios/$b" | tar -x -C "$J/packs" --strip-components=2 || stop "pack export $b"
  C=$J/runs/$rep-$b
  if [ "$PLAN_ONLY" = 1 ]; then
    say "== $rep $b"
    node bench/runner/bench.js judge --run "$U" --extra-tasks "$J/packs/$b" --judges "$PANEL" --mode rubric \
      --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$CAP_USD" --concurrency 1 --plan 2>&1 | tail -n 12
    continue
  fi
  JUDGED+=("$C")
  [ -e "$C.done" ] && { say "$rep $b: judged, skipped"; continue; }
  if [ ! -d "$C" ]; then
    cp -a -- "$U" "$C" || stop "copy $U"
    # Tasks with no judge items stay code-only: a judge can only fail them, so they are left out of the judge copy.
    for t in $(node "$H" code-only "$B" "$J/packs/$b"); do
      for arm in "$C"/*/; do [ -d "$arm$t" ] && rm -r -- "$arm$t"; done
      grep -qx "$t" "$J/code-only.txt" 2>/dev/null || echo "$t" >> "$J/code-only.txt"
      say "$rep $b: $t has no judge items, code-only"
    done
  fi
  aws sts get-caller-identity --profile "$PROFILE" > /dev/null 2>&1 || stop "AWS credentials for profile $PROFILE expired before $rep $b"
  spent=$(node "$H" judge-spent "$J/runs")
  left=$(awk -v s="$spent" -v c="$CAP_USD" -v w="$PER_RUN_WORST" 'BEGIN { if (s + w > c) print "STOP"; else printf "%.4f", c - s }')
  [ "$left" = STOP ] && stop "spent USD $spent of the USD $CAP_USD cap before $rep $b"
  say "$rep $b: judging, spent USD $spent, guard USD $left"
  nice -n 19 node bench/runner/bench.js judge --run "$C" --extra-tasks "$J/packs/$b" --judges "$PANEL" --mode rubric \
    --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$left" --concurrency 1 >> "$C-judge.log" 2>&1
  rc=$?
  say "$rep $b: exit $rc, $(grep '^judged' "$C-judge.log" | tail -n 1)"
  [ "$rc" = 0 ] || stop "judge exit $rc on $rep $b (see $C-judge.log); rerun to resume"
  touch "$C.done"
done
[ "$PLAN_ONLY" = 1 ] && exit 0

EXTRA=$(ls -d "$J"/packs/t* | paste -sd, -)
RUNS=$(printf '%s,' "${JUDGED[@]}"); RUNS=${RUNS%,}
node bench/runner/bench.js report --run "$RUNS" --baseline vanilla --extra-tasks "$EXTRA" --out "$J/report" > "$J/report.log" 2>&1 \
  || say "report failed: see $J/report.log"
say "judge spend USD $(node "$H" judge-spent "$J/runs") of $CAP_USD"
say "report: $J/report (konductor minus vanilla with its 95% range); log $J/report.log"
