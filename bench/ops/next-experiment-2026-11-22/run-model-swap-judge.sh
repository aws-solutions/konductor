#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Judge pass of run-model-swap.sh's natural stage: konductor on Claude Opus 5.5 against konductor and vanilla on Claude
# Sonnet 5.5, the same 8 LITE tasks. Paid in USD, no credits. Not run by the agent that wrote it.
#
#   bash run-model-swap-judge.sh --plan    free: judge calls per task (bench judge --plan) and the USD estimate
#   bash run-model-swap-judge.sh           judge the Opus runs, then write the two reports
#   bash run-model-swap-judge.sh --fill [--plan]   judge only the fill cells (run-model-swap.sh --fill: t1-nfr-report-queries
#                                     reps 2 and 3), cap USD 0.3 counted on their copy alone (approved 2026-11-24); needs
#                                     natural/<task>.done. The reports then cover the first pass and the fill.
#
# Only the 22 Opus runs are judged. The Sonnet konductor and vanilla runs were judged in the LITE first pass
# (lite-run-2026-11-21/judge/runs, r<rep>-<batch>) by the same panel, judge bench (69149846), packs, mode and backend,
# so their judgments are reused as they are, at no cost. Each Opus task folder is judged in a copy under
# judge-model-swap/runs/ whose arm is renamed konductor-opus (model-swap-judge.js prep), so it can sit in one report
# beside the Sonnet konductor arm; the raw runs stay as they ran. None of the 8 tasks is code-only.
# The fill pass copies only the fill cells into judge-model-swap/runs-fill/<task> (prep KEEP), so the first pass's
# judged cells are neither judged nor counted twice.
# Reports (bench report over the Opus copies and the 18 LITE judge dirs; the LITE dirs also hold their batches' other
# tasks, which have no Opus arm):
#   judge-model-swap/report             baseline vanilla: konductor-opus and konductor (Sonnet) each minus Sonnet vanilla
#   judge-model-swap/report-vs-sonnet   baseline konductor: konductor-opus minus Sonnet konductor
#
# Panel: gpt-5.6-luna, deepseek-3.2, qwen3-coder-next: three families, none Claude (both agents are Claude).
# Cap: USD 2 in all (CAP_USD). Before each task, spend so far plus one task's worst case (USD 0.30: 3 runs) must stay
# under the cap, and the bench's own USD guard (--budget-usd, what is left of the cap) checks before every call.
# Rerun to resume: judged tasks are skipped and finished calls are cached.
#
# Test hooks: STUB=<cmd> replaces `node bench/runner/bench.js` and skips the AWS check; BENCH_SHA=<sha> is the commit
# the judge bench must be at (default the frozen 69149846).
set -u
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/reports sets it)}"

WS=$KONDUCTOR_WS
OPS=$(cd "$(dirname "$0")" && pwd)
HERE=$WS/reports/next-experiment-2026-11-22
SRC=$HERE/runs-model-swap/natural
J=$HERE/judge-model-swap
LJ=$WS/reports/lite-run-2026-11-21/judge               # LITE judge pass: bench worktree and judged Sonnet runs, read only
B=$LJ/bench
BENCH_SHA=${BENCH_SHA:-69149846ad65f1016ec386e88ec9043bdec57203}
H=$OPS/../workspace/lite-helper.js
MJ=$OPS/model-swap-judge.js
FILL_JS=$OPS/nudge-fill.js
FILL_SET=model-swap
CAP_USD=${CAP_USD:-2}
APPROVED=2
PER_TASK_WORST=0.3
PROFILE=${AWS_PROFILE_NAME:-default}
PANEL=gpt-5.6-luna,deepseek-3.2,qwen3-coder-next
ARM=konductor-opus
STUB=${STUB:-}
TASKS='t8-dec-deploy-strategy t5-qa-checkout-strategy t5-qa-sync-strategy t6-req-field-inspections t2-dr-notify-fanout t2-arch-dr-split-checkout t7-program-brief t1-nfr-report-queries'
PLAN_ONLY=0
FILL=0
JR=$J/runs                                             # this pass's judge copies (runs-fill with --fill)
. "$(dirname "$0")/../lib.sh"   # say, stop and fail (B-005)

bench() { if [ -n "$STUB" ]; then $STUB "$@"; else nice -n 19 node bench/runner/bench.js "$@"; fi; }

judge_args() {   # run pack budget
  echo --run "$1" --extra-tasks "$2" --judges "$PANEL" --mode rubric --judge-backend opencode \
    --aws-export-profile "$PROFILE" --budget-usd "$3" --concurrency 1
}

# The fill cells' replicates of one task, comma separated ("" for a task outside the fill set).
fill_reps() { node "$FILL_JS" cells "$FILL_SET" | awk -v t="$1" '$1 == t { printf "%s%s", (n++ ? "," : ""), $3 }'; }

# Both reports over every judged copy (first pass and fill) and the LITE judge dirs of their batches.
reports() {
  local d t extra runs
  local -a judged=() packs=() lite=()
  for d in "$J"/runs/*.done "$J"/runs-fill/*.done; do
    [ -e "$d" ] || continue
    t=$(basename "$d" .done)
    judged+=("${d%.done}"); packs+=("$J/packs/${t%%-*}")
    for r in 1 2 3; do lite+=("$LJ/runs/r$r-${t%%-*}"); done
  done
  [ "${#judged[@]}" -gt 0 ] || stop "no judged copy to report"
  extra=$(printf '%s\n' "${packs[@]}" | sort -u | paste -sd, -)
  runs=$(printf '%s,' "${judged[@]}" $(printf '%s\n' "${lite[@]}" | sort -u)); runs=${runs%,}
  bench report --run "$runs" --baseline vanilla --extra-tasks "$extra" --out "$J/report" > "$J/report.log" 2>&1 \
    || say "report failed: see $J/report.log"
  bench report --run "$runs" --baseline konductor --extra-tasks "$extra" --out "$J/report-vs-sonnet" > "$J/report-vs-sonnet.log" 2>&1 \
    || say "report failed: see $J/report-vs-sonnet.log"
}

main() {
  local t batch C n spent left rc est per src keep total=0 usd=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --plan) PLAN_ONLY=1 ;;
      --fill) FILL=1 ;;
      *) stop "unknown argument $1 (use --plan, --fill or nothing)" ;;
    esac
    shift
  done
  if [ "$FILL" = 1 ]; then
    APPROVED=0.3; CAP_USD=${CAP_USD_FILL:-0.3}; JR=$J/runs-fill
    TASKS=$(node "$FILL_JS" cells "$FILL_SET" | cut -d' ' -f1 | sort -u | paste -sd' ' -) || stop "read the fill set"
  fi
  # Never a Claude judge for a Claude agent.
  case ",$PANEL," in *claude*|*sonnet*|*opus*|*haiku*) stop "the panel holds a Claude model: $PANEL" ;; esac
  [ "$(awk -v c="$CAP_USD" -v a="$APPROVED" 'BEGIN { print (c > 0 && c <= a) ? "yes" : "no" }')" = yes ] || stop "CAP_USD $CAP_USD is outside the approved USD $APPROVED"
  [ -d "$B" ] || stop "$B is missing (the LITE judge worktree)"
  [ "$(git -C "$B" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$B is not at $BENCH_SHA"
  [ -z "$(git -C "$B" status --porcelain)" ] || stop "$B has local changes"
  [ -d "$SRC" ] || stop "$SRC is missing: run run-model-swap.sh --go --stage natural first"
  if [ "$FILL" = 1 ] && [ "$PLAN_ONLY" = 0 ]; then
    for t in $TASKS; do [ -e "$SRC/$t.done" ] || stop "$SRC/$t.done is missing: run run-model-swap.sh --fill --go first"; done
  fi
  mkdir -p "$J/packs"
  cd "$B" || exit 1
  for t in $TASKS; do
    batch=${t%%-*}
    keep=''; [ "$FILL" = 1 ] && keep=$(fill_reps "$t")
    n=$(node "$MJ" ran "$SRC/$t") || stop "read $SRC/$t"
    [ "$FILL" = 1 ] && n=$(echo "$keep" | tr ',' '\n' | grep -c .)
    [ "$n" -gt 0 ] || { say "$t: no Opus run, left out"; continue; }
    [ -d "$J/packs/$batch" ] || git -C "$B" archive "$BENCH_SHA" "bench/scenarios/$batch" | tar -x -C "$J/packs" --strip-components=2 || stop "pack export $batch"
    C=$JR/$t
    if [ "$PLAN_ONLY" = 1 ]; then
      read -r per est src <<<"$(node "$MJ" estimate "$LJ/runs" "$t" "$n")"
      say "== $t: $n Opus run(s), Sonnet judge USD $per a run ($src), estimated USD $est"
      # shellcheck disable=SC2046
      bench judge $(judge_args "$SRC/$t" "$J/packs/$batch" "$CAP_USD") --plan 2>&1 | tail -n 12
      total=$((total + n)); usd=$(awk -v a="$usd" -v b="$est" 'BEGIN { printf "%.4f", a + b }')
      continue
    fi
    [ -e "$C.done" ] && { say "$t: judged, skipped"; continue; }
    if [ ! -d "$C" ]; then
      mkdir -p "$JR"
      # shellcheck disable=SC2086
      node "$MJ" prep "$SRC/$t" "$C" "$ARM" $keep > /dev/null || stop "copy $t"
    fi
    if [ -z "$STUB" ]; then
      aws sts get-caller-identity --profile "$PROFILE" > /dev/null 2>&1 || stop "AWS credentials for profile $PROFILE expired before $t"
    fi
    spent=$(node "$H" judge-spent "$JR")
    left=$(awk -v s="$spent" -v c="$CAP_USD" -v w="$PER_TASK_WORST" 'BEGIN { if (s + w > c) print "STOP"; else printf "%.4f", c - s }')
    [ "$left" = STOP ] && stop "spent USD $spent of the USD $CAP_USD cap before $t (one task's worst case is USD $PER_TASK_WORST)"
    say "$t: judging $n run(s), spent USD $spent, guard USD $left"
    rc=0
    # shellcheck disable=SC2046
    bench judge $(judge_args "$C" "$J/packs/$batch" "$left") >> "$C-judge.log" 2>&1 || rc=$?
    say "$t: exit $rc, $(grep '^judged' "$C-judge.log" | tail -n 1)"
    [ "$rc" = 0 ] || stop "judge exit $rc on $t (see $C-judge.log); rerun to resume"
    touch "$C.done"
  done
  if [ "$PLAN_ONLY" = 1 ]; then
    if [ "$FILL" = 1 ]; then echo "fill runs to judge: $total (only the fill cells; the first pass's judgments are reused)"
    else echo "Opus runs to judge: $total (the Sonnet konductor and vanilla judgments are reused, USD 0)"; fi
    echo "estimated USD $usd (LITE USD a run on the same task x 2 for longer answers), cap USD $CAP_USD"
    exit 0
  fi
  reports
  say "judge spend USD $(node "$H" judge-spent "$JR") of $CAP_USD"
  say "reports: $J/report (each arm minus Sonnet vanilla), $J/report-vs-sonnet (konductor-opus minus Sonnet konductor)"
}
main "$@"
