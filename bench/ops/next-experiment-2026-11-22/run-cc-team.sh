#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Second arm of the Claude Code study: konductor WITH team mode (D-241). The study (run-cc-compare.sh) ran cc-vanilla
# and cc-konductor before D-241, so its konductor arm had no CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS and no guide
# permissions. This runs only the new arm, cc-konductor-team (konductor f5d18459, the frozen bench 69149846 plus
# cc-team-mode.patch: settings.json env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 and the guide's 23-entry
# permissions.allow), on the same 8 tasks, 2 replicates, through run-cc-compare.sh with its CC_* overrides and its own
# ROOT. The study's 32 saved runs are reused as they are; --plan checks their setup first (cc-team-reuse.js).
#
#   bash run-cc-team.sh [--plan]       free: reuse check, expected USD a task, the dry run (budgets, worst case), cap
#   bash run-cc-team.sh --prepare      free: team worktree, claude copy, konductor build, no-credential listing probe
#   CC_AWS_PROFILE=<profile> bash run-cc-team.sh --go     PAID (USD, cap 16): rerun to resume
#   bash run-cc-team.sh --judge-plan   free: the judge calls of the new arm
#   AWS_PROFILE_NAME=<profile> bash run-cc-team.sh --judge     PAID (USD, cap 1): judge the new arm only, then one
#                                      report of all three arms (the study's judged copies added)
#   bash run-cc-team.sh --loads        free: cc-skill-loads.js on the new arm and on the study's runs
#   bash run-cc-team.sh --rescore      free: the new arm's code scores with the newest keys (rescore-cc.sh, keys 560dfa03)
#
# Caps: USD 1 a run (claude --max-budget-usd), task budget USD 2 (2 runs), cap USD 16 = 16 runs at their cap; the
# expected cost is the saved cc-konductor cost a task (about USD 0.57 a run, 9.16 in all). Judge: the study's panel
# (gpt-5.6-luna, deepseek-3.2, qwen3-coder-next, rubric, no Claude judge), cap USD 1.
# Under claude -p Claude Code spawns no teammates (agent-teams docs: "non-interactive mode"), so this arm tests
# whether the env flag and allow list change a print-mode run, not agent teams. See cc-team-mode-plan-2026-11-24.md.
# Refused while another paid owner job runs (BUSY_PAT).
#
# Test hooks: STUB, WAIT_PAT, LOAD_MAX, HEAVY_LOCK as run-cc-compare.sh; CC_COMPARE_ROOT (the study, default
# /var/tmp/cc-compare), CC_TEAM_ROOT (default /var/tmp/cc-team), BUSY_PAT, CC_JUDGE_SH, CC_RESCORE_SH, FIXED_BENCH.
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/reports sets it)}"
WS=$KONDUCTOR_WS
HERE0=$(cd "$(dirname "$0")" && pwd)
HERE=$WS/reports/next-experiment-2026-11-22
STUDY=${CC_COMPARE_ROOT:-/var/tmp/cc-compare}
ROOT=${CC_TEAM_ROOT:-/var/tmp/cc-team}
KONDUCTOR_SHA=f5d184596378ae72ae531d80647548512c14cacf
KEYS_SHA=560dfa03                                          # the newest task keys (semantic keys; 38b1ac57 before it)
ARM=cc-konductor-team
MODEL=us.anthropic.claude-sonnet-5-5
CAP_USD=16
JUDGE_CAP_USD=1
R=$WS/worktrees/cc-frozen-69149846                         # stream reader for --loads; cc-team-mode.patch leaves it as is
MANIFEST=$HERE/prefixes/manifest.json
BUSY_PAT=${BUSY_PAT:-run-overnight|run-clean-fill|run-cc-(compare|fill|model-swap)[.]sh|run-model-swap|run-nudge}
JUDGE_SH=${CC_JUDGE_SH:-$HERE0/run-cc-compare-judge.sh}
RESCORE_SH=${CC_RESCORE_SH:-$HERE/rescore-cc.sh}
TASKS='t8-dec-deploy-strategy t5-qa-checkout-strategy t5-qa-sync-strategy t6-req-field-inspections t2-dr-notify-fanout t2-arch-dr-split-checkout t7-program-brief t1-nfr-report-queries'
MODE=${1:---plan}
stop() { echo "stop: $*" >&2; exit 1; }

compare() {
  CC_MODEL=$MODEL CC_ARMS=$ARM=$KONDUCTOR_SHA CC_CAP_USD=$CAP_USD CC_RUN_CAP_USD=1 ROOT=$ROOT \
    bash "$HERE0/run-cc-compare.sh" "$@"
}

reuse() {
  # shellcheck disable=SC2086
  node "$HERE0/cc-team-reuse.js" check "$STUDY/runs" "$STUDY/judge/runs" $TASKS || stop "the saved study is not at the new arm's setup"
}

busy() { if pgrep -f -- "$BUSY_PAT" >/dev/null; then stop "another paid owner job is running ($(pgrep -af -- "$BUSY_PAT" | head -n 1)): run after it ends"; fi; }

# The study's judged copies, comma-joined, for the joint report.
judged_also() {
  local t out=''
  for t in $TASKS; do [ -e "$STUDY/judge/runs/$t.done" ] && out=$out,$STUDY/judge/runs/$t; done
  echo "${out#,}"
}

judge() {
  ROOT=$ROOT CAP_USD=$JUDGE_CAP_USD CC_JUDGE_REPORT=$HERE/judge-cc-team/report CC_JUDGE_ALSO=$(judged_also) bash "$JUDGE_SH" "$@"
}

loads() {   # loads LABEL RUNS CACHE
  local skills
  if [ -z "$(find "$2" -name stream.jsonl -not -path '*/workspace/*' 2>/dev/null | head -n 1)" ]; then echo "$1: no runs yet"; return 0; fi
  skills=$(ls -d "$3"/claude-"${KONDUCTOR_SHA:0:12}"-*/src/dist/claude/skills 2>/dev/null | head -n 1)
  [ -n "$skills" ] || stop "$1: no installed skill tree under $3"
  echo "## $1"; echo
  node "$HERE0/cc-skill-loads.js" "$2" "$MANIFEST" "$R" "$skills"
}

# The newest-key bench: KEYS_SHA's bench/ exported once under ROOT (read only), unless FIXED_BENCH names one.
keys_bench() {
  local d=$ROOT/keys-$KEYS_SHA
  if [ -n "${FIXED_BENCH:-}" ]; then echo "$FIXED_BENCH"; return 0; fi
  if [ ! -d "$d/bench" ]; then
    mkdir -p "$d"
    git -C "$WS/worktrees/konductor-plant" archive "$KEYS_SHA" bench | tar -x -C "$d" || stop "cannot export bench at $KEYS_SHA"
  fi
  echo "$d/bench"
}

case "$MODE" in
  --plan)
    reuse
    echo
    echo "arm $ARM on $MODEL, 16 runs, USD 1 a run, task budget USD 2, cap USD $CAP_USD; root $ROOT"
    compare
    echo
    echo "judge: panel and mode as run-cc-compare-judge.sh, cap USD $JUDGE_CAP_USD, report $HERE/judge-cc-team/report" ;;
  --prepare) compare --prepare ;;
  --go) busy; reuse > /dev/null; compare --go ;;
  --judge-plan) judge --plan ;;
  --judge) busy; judge ;;
  --loads)
    loads "team arm" "$ROOT/runs" "$ROOT/cache"
    loads "study (cc-vanilla, cc-konductor, reused)" "$STUDY/runs" "$STUDY/cache" ;;
  --rescore)
    [ -n "$(find "$ROOT/runs" -name result.json -not -path '*/workspace/*' 2>/dev/null | head -n 1)" ] || [ -n "${STUB:-}" ] || stop "no team runs under $ROOT/runs: run --go first"
    CC_RUNS=$ROOT/runs CC_ARMS=$ARM CC_SCORES_DEST=$HERE/cc-team-scores-newest-keys.tsv FIXED_BENCH=$(keys_bench) \
      KIROCREW_SCRATCH=$ROOT/rescore bash "$RESCORE_SH" ;;
  *) echo "usage: bash $0 [--plan|--prepare|--go|--judge-plan|--judge|--loads|--rescore]"; exit 64 ;;
esac
