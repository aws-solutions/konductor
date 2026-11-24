#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Fill of the Claude Code study (run-cc-compare.sh, cc-vanilla against cc-konductor, 8 tasks x 2 replicates): after the
# study ends, run again only the cells that never really ran, at the exact setup the study ran with.
#
#   bash run-cc-fill.sh [--plan]                   free: every cell that is not a plain success, its rule, the cells to
#                                                  run, each task's budget and the fill cap
#   CC_AWS_PROFILE=<profile> bash run-cc-fill.sh --go    PAID (USD): runs them; rerun to resume
#
# The setup is the study's own, not the branch head's: run-cc-compare.sh was launched at 15385f6d, before D-241 put
# team mode on its bench, so this script runs the plain frozen bench worktrees/cc-frozen-69149846 (BENCH_SHA, no
# patch), the same claude copy, model, arms, seed, effort, isolation and USD 1 run cap. A task folder whose
# run-config.json names another bench commit is refused, so a fill never mixes two harnesses in one task.
# Which cells run (cc-fill.js has the rules): a cell with no result or a budget skip, and an infra error (moved aside
# first as <rep>.prefill-N). A success, an agent self-kill, a timeout and a stop at the run's USD cap are run results
# and stay; the last three are flagged in the plan. Any other error stops --go until the owner rules on it.
# Cap: the cells to run are frozen at the first --go (ROOT/fill-cells.txt, ROOT/fill-start). Each counts at most
# USD 1 x OVER (1.5, room for claude passing its own --max-budget-usd by a turn); the fill cap is their sum, spend is
# every ledger run entry since fill-start (throttled tries included), and a task starts only if spend plus its cells x
# USD 1.5 fits the cap. The task budget is cells x USD 1.5, so the frozen runner (it starts a run while charged +
# largest run <= budget) starts every cell.
# Refused while run-cc-compare.sh runs, or when a task to fill already has a judge copy (ROOT/judge/runs/<task>): judge
# after the fill (run-cc-compare-judge.sh judges every task with a .done).
#
# Test hooks: STUB=<cmd> replaces the bench command and skips the frozen worktree, claude, python and user-namespace
# checks; ROOT, HEAVY_LOCK, LOAD_MAX, WAIT_PAT (other bench runs), CC_MAIN_PAT (the main study) and CHECK_BENCH (the
# checkout whose self-kill reader cc-fill.js uses) override the paths and host checks.
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/reports sets it)}"
WS=$KONDUCTOR_WS
HERE0=$(cd "$(dirname "$0")" && pwd)
CHECK_BENCH=${CHECK_BENCH:-$(cd "$HERE0/../../.." && pwd)}
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203      # the study's frozen bench, with no team-mode patch
KONDUCTOR_SHA=f5d184596378ae72ae531d80647548512c14cacf
R=$WS/worktrees/cc-frozen-69149846                      # the worktree the study ran from; read only
ROOT=${ROOT:-/var/tmp/cc-compare}
OUT=$ROOT/runs
CACHE=$ROOT/cache
CLAUDE_VERSION=2.1.330.1791
CLAUDE_PIN=f390eaa0814e6a1bff74cbb47acb74cb9c89d30ced809fe0af5af00c7bfe8ebb
CLAUDE_BIN=$ROOT/bin/$CLAUDE_VERSION/claude              # the study's own copy
MODEL=us.anthropic.claude-sonnet-5-5
ARMS=cc-vanilla,cc-konductor=$KONDUCTOR_SHA
REPS=2
RUN_CAP_USD=1
OVER=1.5
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
LOAD_MAX=${LOAD_MAX:-4}
WAIT_PAT=${WAIT_PAT:-bench/runner/bench[.]js run}
CC_MAIN_PAT=${CC_MAIN_PAT:-run-cc-compare[.]sh}
STUB=${STUB:-}
FJ=$HERE0/cc-fill.js
MODE=${1:---plan}
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { echo "stop: $*" >&2; exit 1; }
. "$HERE0/lib.sh"   # wait_host

# task batch (the study's order)
TASKS='t8-dec-deploy-strategy t8
t5-qa-checkout-strategy t5
t5-qa-sync-strategy t5
t6-req-field-inspections t6
t2-dr-notify-fanout t2
t2-arch-dr-split-checkout t2
t7-program-brief t7
t1-nfr-report-queries t1'

cells() { node "$FJ" cells "$OUT" "$1" "$RUN_CAP_USD" "$CHECK_BENCH"; }
count() { printf '%s\n' "$2" | awk -v w="$1" '$3 == w { n++ } END { print n + 0 }'; }   # count ACTION ROWS
cell_w() { awk -v l="$RUN_CAP_USD" -v o="$OVER" -v n="${1:-1}" 'BEGIN { printf "%.2f", n * l * o }'; }

# The bench commit a task folder was run by must be BENCH_SHA (no folder: nothing to check).
check_commit() {
  local got
  [ -e "$OUT/$1/run-config.json" ] || return 0
  got=$(node -e 'console.log(require(process.argv[1]).benchCommit ?? "-")' "$OUT/$1/run-config.json")
  [ "$got" = "$BENCH_SHA" ] || stop "$OUT/$1 was run by bench ${got:0:8}, not ${BENCH_SHA:0:8}: a fill would mix two harnesses in one task"
}

bench_args() {   # as run-cc-compare.sh at 15385f6d, the commit the study was launched from
  BENCH=(node "$R/bench/runner/bench.js" run --suite pilot --tasks "$1" --arms "$ARMS" --replicates "$REPS" --parallel 1
    --extra-tasks "$R/bench/scenarios/$2" --repo-root "$R" --hide "$R" --isolate unshare --seed 20261121
    --claude-bin "$CLAUDE_BIN" --model "$MODEL" --effort high --run-budget-usd "$RUN_CAP_USD" --python "$PY312" --cache "$CACHE")
}

# Plan pass over every task: prints the table and the non-success cells; sets RUN_N, ASK and RUN_LIST.
survey() {
  local t b rows k f q
  RUN_N=0; ASK=''; RUN_LIST=''
  echo "| task | cells to run | flagged (kept) | ask | budget USD | worst case after |"
  echo "| --- | --- | --- | --- | --- | --- |"
  while read -r t b; do
    check_commit "$t"
    rows=$(cells "$t") || stop "cannot read the cells of $t"
    k=$(count run "$rows"); f=$(count flag "$rows"); q=$(count ask "$rows")
    [ "$k" = 0 ] && [ "$f" = 0 ] && [ "$q" = 0 ] && continue
    if [ "$k" = 0 ]; then echo "| $t | 0 | $f | $q | - | - |"
    else echo "| $t | $k | $f | $q | $(cell_w "$k") | $(awk -v a="$PLAN_SPENT" -v b="$(cell_w "$k")" 'BEGIN { printf "%.2f", a + b }') |"
      PLAN_SPENT=$(awk -v a="$PLAN_SPENT" -v b="$(cell_w "$k")" 'BEGIN { printf "%.2f", a + b }'); fi
    RUN_N=$((RUN_N + k))
    RUN_LIST=$RUN_LIST$(printf '%s\n' "$rows" | awk -v t="$t" '$3 == "run" { print t, $1, $2 }')$'\n'
    ASK=$ASK$(printf '%s\n' "$rows" | awk -v t="$t" '$3 == "ask" { print t, $0 }')
    printf '%s\n' "$rows" | awk -v t="$t" '$3 != "keep" { print "  cell: " t " " $0 }'
  done <<EOF
$TASKS
EOF
}

# One task of the fill (--go).
fill_task() {
  local t=$1 b=$2 rows k s budget after rc=0 a r st
  local -a resume=()
  rows=$(cells "$t")
  k=$(count run "$rows")
  [ "$k" = 0 ] && { [ -e "$OUT/$t" ] && [ ! -e "$OUT/$t.done" ] && touch "$OUT/$t.done"; return 0; }
  [ ! -e "$ROOT/judge/runs/$t" ] || stop "$t already has a judge copy ($ROOT/judge/runs/$t): fill before judging"
  wait_host "$WAIT_PAT"
  s=$(node "$FJ" spent "$OUT" "$(cat "$ROOT/fill-start")" "$RUN_CAP_USD")
  budget=$(cell_w "$k")
  after=$(awk -v a="$s" -v b="$budget" 'BEGIN { printf "%.2f", a + b }')
  awk -v a="$after" -v c="$CAP" 'BEGIN { exit !(a > c + 1e-9) }' && stop "counted USD $s of $CAP: $t ($k cell(s), worst case USD $budget) does not fit the fill cap"
  # An errored cell that ran is moved aside, so --resume runs it again; a never-run cell has no result to move.
  while read -r a r _ ; do
    st=$(node -e 'try { console.log(require(process.argv[1]).status) } catch { console.log("-") }' "$OUT/$t/$a/$t/$r/result.json")
    case "$st" in -|budget_skipped) ;; *) say "$t $a #$r: moved aside to $(node "$FJ" aside "$OUT" "$t" "$a" "$r")" ;; esac
  done <<EOF
$(printf '%s\n' "$rows" | awk '$3 == "run" { print $1, $2 }')
EOF
  [ -f "$OUT/$t/run-config.json" ] && resume=(--resume)
  say "$t: $k cell(s), counted USD $s of $CAP, budget USD $budget, worst case after $after"
  bench_args "$t" "$b"
  mkdir -p "$OUT"
  if [ -n "$STUB" ]; then $STUB "${BENCH[@]}" --aws-profile "$CC_AWS_PROFILE" --budget-usd "$budget" --out "$OUT/$t" "${resume[@]}" </dev/null || rc=$?
  else nice -n 10 "${BENCH[@]}" --aws-profile "$CC_AWS_PROFILE" --budget-usd "$budget" --out "$OUT/$t" "${resume[@]}" </dev/null >> "$OUT/$t.fill.log" 2>&1 || rc=$?; fi
  [ "$rc" = 0 ] || stop "$t exited $rc (log $OUT/$t.fill.log); rerun to resume"
  rows=$(cells "$t")
  if [ "$(count run "$rows")" != 0 ]; then stop "$t: cells still to run after the fill (see run-cc-fill.sh --plan); rerun to resume"; fi
  touch "$OUT/$t.done"
}

main() {
  local t b
  case "$MODE" in --plan|--go) ;; *) echo "usage: bash $0 [--plan|--go]"; exit 64 ;; esac
  case "$(realpath -m -- "$ROOT")/" in "$(realpath -m -- "$HOME")"/*) stop "ROOT $ROOT is under HOME; work dirs go outside it" ;; esac
  export TMPDIR=/tmp   # as the study: bench refuses a Claude Code scratch dir under HOME
  PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
  if [ -z "$STUB" ]; then
    [ -e "$R" ] || stop "$R is missing (the study's frozen worktree)"
    [ "$(git -C "$R" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$R is not at $BENCH_SHA"
    [ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes"
    [ -x "$CLAUDE_BIN" ] && [ "$(sha256sum "$CLAUDE_BIN" | cut -d' ' -f1)" = "$CLAUDE_PIN" ] || stop "$CLAUDE_BIN is not the study's pinned claude $CLAUDE_VERSION"
    [ -n "$PY312" ] || stop "no python 3.12"
  fi
  if pgrep -f "$CC_MAIN_PAT" >/dev/null; then
    [ "$MODE" = --go ] && stop "run-cc-compare.sh is still running: fill after it ends"
    echo "note: run-cc-compare.sh is still running; this plan reads a study that is not finished"
  fi
  if [ "$MODE" = --go ]; then
    [ -n "${CC_AWS_PROFILE:-}" ] || stop "a paid run needs CC_AWS_PROFILE, the AWS profile whose keys claude may use"
    [ -n "$STUB" ] || unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them): run from your own terminal"
  fi
  [ -d "$OUT" ] || stop "$OUT is missing: run run-cc-compare.sh --go first"
  PLAN_SPENT=0
  if [ -e "$ROOT/fill-start" ]; then PLAN_SPENT=$(node "$FJ" spent "$OUT" "$(cat "$ROOT/fill-start")" "$RUN_CAP_USD"); fi
  SPENT0=$PLAN_SPENT
  survey
  if [ -n "$ASK" ] && [ "$MODE" = --go ]; then
    stop "the owner must rule on these cells (an error cc-fill.js cannot place): $(echo "$ASK" | tr '\n' ';')"
  fi
  if [ -e "$ROOT/fill-cells.txt" ]; then CAP=$(cell_w "$(grep -c . "$ROOT/fill-cells.txt")"); else CAP=$(cell_w "$RUN_N"); fi
  echo; echo "fill cap USD $CAP: $RUN_N cell(s) to run now, each at most USD $RUN_CAP_USD x $OVER; counted so far USD $SPENT0"
  [ "$MODE" = --go ] || { echo "bench: ${R}, claude $CLAUDE_BIN, model $MODEL, arms $ARMS"; exit 0; }
  [ "$RUN_N" -gt 0 ] || { say "nothing to fill"; exit 0; }
  if [ ! -e "$ROOT/fill-cells.txt" ]; then
    printf '%s' "$RUN_LIST" | grep . > "$ROOT/fill-cells.txt"
    date -u +%Y-%m-%dT%H:%M:%S.000Z > "$ROOT/fill-start"
    say "fill frozen: $RUN_N cell(s) in $ROOT/fill-cells.txt, cap USD $CAP"
  fi
  while read -r t b; do fill_task "$t" "$b"; done <<EOF
$TASKS
EOF
  say "fill done, counted USD $(node "$FJ" spent "$OUT" "$(cat "$ROOT/fill-start")" "$RUN_CAP_USD") of $CAP; judge next: run-cc-compare-judge.sh"
}
main "$@"
