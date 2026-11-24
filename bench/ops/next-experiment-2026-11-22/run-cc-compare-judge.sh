#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Judge pass of run-cc-compare.sh (cc-vanilla against cc-konductor, 8 tasks, 2 replicates). Copied from
# run-forced-judge.sh. Paid in USD, no credits. Not run by the agent that wrote it.
#
#   bash run-cc-compare-judge.sh --plan    free: judge calls and estimated USD per finished task; no model call
#   bash run-cc-compare-judge.sh           judge every finished task, then write the report (cc-konductor - cc-vanilla)
#
# Panel: gpt-5.6-luna, deepseek-3.2, qwen3-coder-next: three families, none Claude (the agent is Claude Sonnet 5.5).
# Same judge bench (the LITE judge worktree at the frozen bench commit 69149846, read only here), mode, backend and
# settings as the LITE and forced judge passes, so these runs are scored the way the Kiro runs were.
# Cap: USD 2 in all (CAP_USD). Before each task, spend so far plus one task's worst case (USD 0.20: 4 runs, against
# the forced pass's USD 0.30 for 6) must stay under the cap, and the bench's own USD guard (--budget-usd, what is left
# of the cap) checks before every call. Each task is judged in a copy under ROOT/judge/runs, so the raw runs stay as
# they ran; the report goes to reports/next-experiment-2026-11-22/judge-cc/report. Rerun to resume.
# run-cc-team.sh sets ROOT (its own runs), CAP_USD, CC_JUDGE_REPORT (its own report) and CC_JUDGE_ALSO (the study's
# judged copies, added to the report so it holds all three arms); with none set the pass is as before.
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"

WS=$KONDUCTOR_WS
HERE=$WS/reports/next-experiment-2026-11-22
ROOT=${ROOT:-/var/tmp/cc-compare}
OUT=$ROOT/runs
J=$ROOT/judge
REPORT=${CC_JUDGE_REPORT:-$HERE/judge-cc/report}      # run-cc-team.sh: its own report
ALSO=${CC_JUDGE_ALSO:-}                               # run-cc-team.sh: more judged run dirs (comma list) for the report
B=$WS/reports/lite-run-2026-11-21/judge/bench          # LITE judge worktree, read only here
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203
H=$WS/scripts/lite-helper.js
CAP_USD=${CAP_USD:-2}
PER_TASK_WORST=0.2
PROFILE=${AWS_PROFILE_NAME:-default}
PANEL=gpt-5.6-luna,deepseek-3.2,qwen3-coder-next
PLAN_ONLY=0
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }

main() {
  local t batch C c arm spent left rc tasks extra runs
  local -a judged=() packs=()
  [ "${1:-}" = --plan ] && PLAN_ONLY=1
  # Never a Claude judge for a Claude agent.
  case ",$PANEL," in *claude*|*sonnet*|*opus*|*haiku*) stop "the panel holds a Claude model: $PANEL" ;; esac
  [ "$(awk -v c="$CAP_USD" 'BEGIN { print (c > 0 && c <= 2) ? "yes" : "no" }')" = yes ] || stop "CAP_USD $CAP_USD is outside the approved USD 2"
  [ -d "$B" ] || stop "$B is missing (the LITE judge worktree)"
  [ "$(git -C "$B" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$B is not at $BENCH_SHA"
  [ -z "$(git -C "$B" status --porcelain)" ] || stop "$B has local changes"
  tasks=$(ls "$OUT" 2>/dev/null | sed -n 's/[.]done$//p' | sort)
  [ -n "$tasks" ] || stop "no finished task under $OUT: run run-cc-compare.sh --go first"
  mkdir -p "$J/packs" "$J/runs" "$REPORT"
  cd "$B" || exit 1
  for t in $tasks; do
    batch=${t%%-*}
    [ -d "$J/packs/$batch" ] || git -C "$B" archive "$BENCH_SHA" "bench/scenarios/$batch" | tar -x -C "$J/packs" --strip-components=2 || stop "pack export $batch"
    packs+=("$J/packs/$batch")
    C=$J/runs/$t
    if [ "$PLAN_ONLY" = 1 ]; then
      say "== $t"
      node bench/runner/bench.js judge --run "$OUT/$t" --extra-tasks "$J/packs/$batch" --judges "$PANEL" --mode rubric \
        --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$CAP_USD" --concurrency 1 --plan 2>&1 | tail -n 12
      continue
    fi
    judged+=("$C")
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
    left=$(awk -v s="$spent" -v c="$CAP_USD" -v w="$PER_TASK_WORST" 'BEGIN { if (s + w > c) print "STOP"; else printf "%.4f", c - s }')
    [ "$left" = STOP ] && stop "spent USD $spent of the USD $CAP_USD cap before $t (one task's worst case is USD $PER_TASK_WORST)"
    say "$t: judging, spent USD $spent, guard USD $left"
    rc=0
    nice -n 19 node bench/runner/bench.js judge --run "$C" --extra-tasks "$J/packs/$batch" --judges "$PANEL" --mode rubric \
      --judge-backend opencode --aws-export-profile "$PROFILE" --budget-usd "$left" --concurrency 1 >> "$C-judge.log" 2>&1 || rc=$?
    say "$t: exit $rc, $(grep '^judged' "$C-judge.log" | tail -n 1)"
    [ "$rc" = 0 ] || stop "judge exit $rc on $t (see $C-judge.log); rerun to resume"
    touch "$C.done"
  done
  [ "$PLAN_ONLY" = 1 ] && exit 0
  extra=$(printf '%s\n' "${packs[@]}" | sort -u | paste -sd, -)
  runs=$(printf '%s,' "${judged[@]}"); runs=${runs%,}${ALSO:+,$ALSO}
  node bench/runner/bench.js report --run "$runs" --baseline cc-vanilla --extra-tasks "$extra" --out "$REPORT" > "$REPORT.log" 2>&1 \
    || say "report failed: see $REPORT.log"
  say "judge spend USD $(node "$H" judge-spent "$J/runs") of $CAP_USD"
  say "report: $REPORT (cc-konductor minus cc-vanilla with its 95% range); log $REPORT.log"
}
main "$@"
