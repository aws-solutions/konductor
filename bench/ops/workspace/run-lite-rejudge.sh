#!/usr/bin/env bash
# Re-judge of the LITE konductor-vs-plain run with the unquoted-evidence re-ask (judge --reask-unquoted). Paid (USD).
# Owner-approved 2026-11-22: cap USD 5, non-Claude judges only.
#
#   bash run-lite-rejudge.sh --plan    free: per-unit calls and cache hits, then the call count and worst-case USD
#   bash run-lite-rejudge.sh           starts itself detached (setsid nohup) and logs to judge/rejudge.log
#   bash run-lite-rejudge.sh --foreground   the paid pass in this shell
#
# Same panel (gpt-5.6-luna, deepseek-3.2, qwen3-coder-next: no Claude family), backend, packs and code-only list as
# run-lite-judge.sh. The bench code is REJUDGE_SHA (feat/bench-pilot-nk with --reask-unquoted). Each unit starts from a
# fresh copy of the raw run with only the first pass's call cache carried over, so each first call has the same prompt
# and comes from the cache at no cost; the new calls are the re-asks (at most one per judge and run) and the few calls
# the first pass did not finish.
# Spend: before each unit, spend so far plus one call and its re-ask at the worst case (2 x USD 0.05) must fit under
# CAP_USD, and the bench's USD guard (--budget-usd, what is left of the cap) checks before every call, a re-ask
# included, so the pass stops before the cap. It waits for the heavy lock (a pilot wave or full suite holds it) and
# holds the LITE lock so it never overlaps another LITE run. Output: judge/rejudge-runs/, judge/rejudge-report/ and
# judge/rejudge-gap.md. judge/runs/ and the raw runs are read only. Rerun to resume: finished units are skipped.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

WS=$KONDUCTOR_WS
PILOT=$WS/worktrees/pilot
ROOT=$WS/reports/lite-run-2026-11-21
J=$ROOT/judge
OUT=$J/rejudge-runs
H=$WS/scripts/lite-helper.js
REJUDGE_SHA=${REJUDGE_SHA:-1ab50a61}
CAP_USD=${CAP_USD:-5}
WORST_PER_CALL=0.05
PROFILE=${AWS_PROFILE_NAME:-default}
PANEL=gpt-5.6-luna,deepseek-3.2,qwen3-coder-next
HEAVY_LOCK=/var/tmp/konductor-heavy.lock
LITE_LOCK=/var/tmp/konductor-lite.lock
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }

MODE=${1:-}
case "$MODE" in ''|--foreground|--plan) ;; *) echo "usage: bash $0 [--plan|--foreground]"; exit 64 ;; esac
if [ -z "$MODE" ]; then
  setsid nohup bash "$0" --foreground >> "$J/rejudge.log" 2>&1 < /dev/null &
  echo "re-judge started in the background (pid $!). Watch: tail -f $J/rejudge.log"
  exit 0
fi
PLAN_ONLY=0; [ "$MODE" = --plan ] && PLAN_ONLY=1

[ -d "$J/packs" ] || stop "no $J/packs: run run-lite-judge.sh first"
case ",$PANEL," in *claude*|*sonnet*|*opus*|*haiku*) stop "the panel must have no Claude family: $PANEL" ;; esac
B=$J/bench-rejudge
[ -d "$B" ] || git -C "$PILOT" worktree add -q --detach "$B" "$REJUDGE_SHA" || stop "cannot add a worktree at $REJUDGE_SHA"
[ "$(git -C "$B" rev-parse HEAD)" = "$(git -C "$PILOT" rev-parse "$REJUDGE_SHA")" ] || stop "$B is not at $REJUDGE_SHA"
grep -q "'reask-unquoted'" "$B/bench/runner/lib/cli-flags.js" || stop "$REJUDGE_SHA has no --reask-unquoted"
mkdir -p "$OUT"

UNITS=$(ls -d "$J"/runs/r*-t* 2>/dev/null | grep -v '[.]\(done\|log\)$' | sort)
[ -n "$UNITS" ] || stop "no judged units under $J/runs"

if [ "$PLAN_ONLY" = 1 ]; then
  cd "$B" || exit 1
  calls=0; cached=0
  for P in $UNITS; do
    name=$(basename "$P"); b=${name#*-}
    [ -e "$P.done" ] || { say "$name: first pass not finished, left out"; continue; }
    line=$(node bench/runner/bench.js judge --run "$P" --extra-tasks "$J/packs/$b" --judges "$PANEL" --mode rubric --reask-unquoted \
      --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$CAP_USD" --concurrency 1 --plan 2>&1 | grep '^already cached')
    say "$name: $line"
    set -- $line; cached=$((cached + $3)); calls=$((calls + $5))
  done
  say "first calls: $calls, of which $cached come from the cache"
  node "$WS/scripts/lite-rejudge-estimate.js" "$J/runs" "$CAP_USD"
  say "plan only: nothing was called and nothing was written"
  exit 0
fi

exec 8> "$LITE_LOCK"; flock -n 8 || stop "another LITE run holds $LITE_LOCK"
exec 9> "$HEAVY_LOCK"; say "waiting for the heavy lock $HEAVY_LOCK (up to 60 min)"
flock -x -w 3600 9 || stop "the heavy lock stayed taken for 60 minutes; rerun later (it resumes)"
cd "$B" || exit 1
say "run-lite-rejudge.sh at $REJUDGE_SHA, cap USD $CAP_USD, panel $PANEL"
JUDGED=()
for P in $UNITS; do
  name=$(basename "$P"); rep=${name%%-*}; b=${name#*-}
  [ -e "$P.done" ] || { say "$name: first pass not finished, left out"; continue; }
  C=$OUT/$name
  JUDGED+=("$C")
  [ -e "$C.done" ] && { say "$name: re-judged, skipped"; continue; }
  if [ ! -d "$C" ]; then
    cp -a -- "$ROOT/runs/$rep/$b" "$C" || stop "copy $rep/$b"
    for t in $(cat "$J/code-only.txt" 2>/dev/null); do
      for arm in "$C"/*/; do [ -d "$arm$t" ] && rm -r -- "$arm$t"; done
    done
    mkdir -p "$C/judge" && cp -a -- "$P/judge/cache" "$C/judge/cache" || stop "copy the call cache of $name"
  fi
  aws sts get-caller-identity --profile "$PROFILE" > /dev/null 2>&1 || stop "AWS credentials for profile $PROFILE expired before $name; refresh them and rerun"
  spent=$(node "$H" judge-spent "$OUT")
  left=$(awk -v s="$spent" -v c="$CAP_USD" -v w="$WORST_PER_CALL" 'BEGIN { if (s + 2 * w > c) print "STOP"; else printf "%.4f", c - s }')
  [ "$left" = STOP ] && stop "spent USD $spent of the USD $CAP_USD cap; one more call and its re-ask (2 x USD $WORST_PER_CALL) do not fit"
  say "$name: re-judging, spent USD $spent, guard USD $left"
  nice -n 19 node bench/runner/bench.js judge --run "$C" --extra-tasks "$J/packs/$b" --judges "$PANEL" --mode rubric --reask-unquoted \
    --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$left" --concurrency 1 >> "$C-judge.log" 2>&1
  rc=$?
  say "$name: exit $rc, $(grep '^judged' "$C-judge.log" | tail -n 1)"
  [ "$rc" = 0 ] || stop "judge exit $rc on $name (see $C-judge.log); rerun to resume"
  touch "$C.done"
done

EXTRA=$(ls -d "$J"/packs/t* | paste -sd, -)
RUNS=$(printf '%s,' "${JUDGED[@]}"); RUNS=${RUNS%,}
node bench/runner/bench.js report --run "$RUNS" --baseline vanilla --extra-tasks "$EXTRA" --out "$J/rejudge-report" > "$J/rejudge-report.log" 2>&1 \
  || say "report failed: see $J/rejudge-report.log"
node "$WS/scripts/lite-rejudge-gap.js" "$J" > "$J/rejudge-gap.md" || say "gap table failed"
say "re-judge spend USD $(node "$H" judge-spent "$OUT") of $CAP_USD"
say "done: $J/rejudge-gap.md (per-task judged gap, before and after), report $J/rejudge-report"
