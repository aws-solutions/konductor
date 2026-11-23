#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Judge pass of the nudge-arm run (run-nudge.sh). Paid in USD, no credits. Not run by the agent that wrote it.
#
#   bash run-nudge-judge.sh --plan    free: judge calls and estimated USD per task; no model call
#   bash run-nudge-judge.sh           judge every finished task, then write the report (konductor-list against konductor-filler)
#
# Panel: gpt-5.6-luna, deepseek-3.2, qwen3-coder-next: three families, none Claude (the agent is claude-sonnet-5.5).
# Same judge bench (the LITE judge worktree at the frozen bench commit 69149846), mode, backend and settings as the
# LITE judge pass and the forced run, so every arm is scored the same way (t6 on its frozen v5 rubric).
# Cap: USD 2 in all (CAP_USD). Before each task, spend so far plus one run's worst case (3 judges x 2 calls x USD 0.05)
# must stay under the cap, and the bench's own USD guard (--budget-usd, what is left of the cap) checks before every call.
# Each task is judged in a copy under judge-nudge/runs/, so the raw runs stay as they ran. Rerun to resume: judged tasks
# are skipped and finished calls are cached.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

WS=$KONDUCTOR_WS
HERE=$WS/reports/next-experiment-2026-11-22
OUT=$HERE/runs-nudge
J=$HERE/judge-nudge
B=$WS/reports/lite-run-2026-11-21/judge/bench          # LITE judge worktree, read only here
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203
H=$WS/scripts/lite-helper.js
CAP_USD=${CAP_USD:-2}
PER_RUN_WORST=0.3
PROFILE=${AWS_PROFILE_NAME:-default}
PANEL=gpt-5.6-luna,deepseek-3.2,qwen3-coder-next
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }
PLAN_ONLY=0; [ "${1:-}" = --plan ] && PLAN_ONLY=1

# Never a Claude judge for a Claude agent.
case ",$PANEL," in *claude*|*sonnet*|*opus*|*haiku*) stop "the panel holds a Claude model: $PANEL" ;; esac
CAP_OK=$(awk -v c="$CAP_USD" 'BEGIN { print (c > 0 && c <= 2) ? "yes" : "no" }')
[ "$CAP_OK" = yes ] || stop "CAP_USD $CAP_USD is outside the approved USD 2"
[ -d "$B" ] || stop "$B is missing (the LITE judge worktree)"
[ "$(git -C "$B" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$B is not at $BENCH_SHA"
[ -z "$(git -C "$B" status --porcelain)" ] || stop "$B has local changes"
mkdir -p "$J/packs" "$J/runs"

TASKS=$(ls "$OUT" 2>/dev/null | sed -n 's/[.]done$//p' | sort)
[ -n "$TASKS" ] || stop "no finished task under $OUT: run run-nudge.sh --go first"
cd "$B" || exit 1
JUDGED=()
PACKS=()
for t in $TASKS; do
  batch=${t%%-*}
  [ -d "$J/packs/$batch" ] || git -C "$B" archive "$BENCH_SHA" "bench/scenarios/$batch" | tar -x -C "$J/packs" --strip-components=2 || stop "pack export $batch"
  PACKS+=("$J/packs/$batch")
  C=$J/runs/$t
  if [ "$PLAN_ONLY" = 1 ]; then
    say "== $t"
    node bench/runner/bench.js judge --run "$OUT/$t" --extra-tasks "$J/packs/$batch" --judges "$PANEL" --mode rubric \
      --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$CAP_USD" --concurrency 1 --plan 2>&1 | tail -n 12
    continue
  fi
  JUDGED+=("$C")
  [ -e "$C.done" ] && { say "$t: judged, skipped"; continue; }
  if [ ! -d "$C" ]; then
    cp -a -- "$OUT/$t" "$C" || stop "copy $t"
    # A task with no judge items stays code-only: a judge can only fail it, so it is left out of the judge copy.
    for c in $(node "$H" code-only "$B" "$J/packs/$batch"); do
      for arm in "$C"/*/; do [ -d "$arm$c" ] && rm -r -- "$arm$c"; done
      grep -qx "$c" "$J/code-only.txt" 2>/dev/null || echo "$c" >> "$J/code-only.txt"
      say "$t: $c has no judge items, code-only"
    done
  fi
  aws sts get-caller-identity --profile "$PROFILE" > /dev/null 2>&1 || stop "AWS credentials for profile $PROFILE expired before $t"
  spent=$(node "$H" judge-spent "$J/runs")
  left=$(awk -v s="$spent" -v c="$CAP_USD" -v w="$PER_RUN_WORST" 'BEGIN { if (s + w > c) print "STOP"; else printf "%.4f", c - s }')
  [ "$left" = STOP ] && stop "spent USD $spent of the USD $CAP_USD cap before $t"
  say "$t: judging, spent USD $spent, guard USD $left"
  nice -n 19 node bench/runner/bench.js judge --run "$C" --extra-tasks "$J/packs/$batch" --judges "$PANEL" --mode rubric \
    --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$left" --concurrency 1 >> "$C-judge.log" 2>&1
  rc=$?
  say "$t: exit $rc, $(grep '^judged' "$C-judge.log" | tail -n 1)"
  [ "$rc" = 0 ] || stop "judge exit $rc on $t (see $C-judge.log); rerun to resume"
  touch "$C.done"
done
[ "$PLAN_ONLY" = 1 ] && exit 0

EXTRA=$(printf '%s\n' "${PACKS[@]}" | sort -u | paste -sd, -)
RUNS=$(printf '%s,' "${JUDGED[@]}"); RUNS=${RUNS%,}
node bench/runner/bench.js report --run "$RUNS" --baseline konductor-filler --extra-tasks "$EXTRA" --out "$J/report" > "$J/report.log" 2>&1 \
  || say "report failed: see $J/report.log"
say "judge spend USD $(node "$H" judge-spent "$J/runs") of $CAP_USD"
say "report: $J/report (konductor-list minus konductor-filler with its 95% range); log $J/report.log"
