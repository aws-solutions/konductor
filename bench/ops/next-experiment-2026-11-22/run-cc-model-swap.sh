#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Claude Code twin of run-model-swap.sh: does skill loading differ between Sonnet 5.5 and Opus 5.5 on Claude Code?
# cc-konductor only (konductor f5d18459 installed for Claude Code), the same 8 LITE tasks, frozen bench 69149846, the
# pinned claude, 2 replicates, everything as run-cc-compare.sh, which runs each stage with its CC_* overrides:
#
#   sonnet  cc-konductor on us.anthropic.claude-sonnet-5-5, 16 runs, USD 1 a run, cap USD 16
#   opus    cc-konductor on us.anthropic.claude-opus-5-5,   16 runs, USD 2 a run, cap USD 32 (all 16 fit at their cap)
#
# The Sonnet stage is only needed when run-cc-compare.sh has not run: its cc-konductor runs are the same arm on the same
# model and settings, so they are reused, and --go --stage sonnet is refused once any of its tasks is done.
#
#   bash run-cc-model-swap.sh --plan                 free: reuse, then each stage's dry run (budgets, worst case) and USD
#   bash run-cc-model-swap.sh --prepare --stage S    free: run-cc-compare.sh --prepare for the stage (build, no agent)
#   CC_AWS_PROFILE=<profile> bash run-cc-model-swap.sh --go --stage S    PAID (USD): rerun to resume
#   bash run-cc-model-swap.sh --summary              free: cc-skill-loads.js per source (run-cc-compare, sonnet, opus)
#
# Expected USD a run: SONNET_USD (run-cc-compare.sh's figure, the STANDARD Claude Code step), times OPUS_FACTOR on Opus
# (Opus over Sonnet konductor credits a run on these 8 tasks in run-model-swap.sh's natural stage: 12.64 / 6.77).
# The Opus model id follows the Bedrock pattern of the Sonnet one and is not checked here: the runner's model check
# flags a run whose stream shows another model, so a wrong id fails on the first run.
#
# Test hooks: STUB as in run-cc-compare.sh; CCM_ROOT is the stage roots' parent (default /var/tmp/cc-model-swap);
# CC_COMPARE_ROOT is run-cc-compare.sh's ROOT (default /var/tmp/cc-compare).
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/reports sets it)}"
WS=$KONDUCTOR_WS
HERE0=$(cd "$(dirname "$0")" && pwd)
CCM_ROOT=${CCM_ROOT:-/var/tmp/cc-model-swap}
CC_COMPARE_ROOT=${CC_COMPARE_ROOT:-/var/tmp/cc-compare}
KONDUCTOR_SHA=f5d184596378ae72ae531d80647548512c14cacf
R=$WS/worktrees/cc-frozen-69149846
MANIFEST=$WS/reports/next-experiment-2026-11-22/prefixes/manifest.json
SONNET_USD=0.67
OPUS_FACTOR=1.87
RUNS=16                                                  # 8 tasks x 2 replicates, one arm
MODE=--plan
STAGE=''
stop() { echo "stop: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --plan|--prepare|--go|--summary) MODE=$1 ;;
    --stage) [ $# -ge 2 ] || stop "--stage needs sonnet or opus"; STAGE=$2; shift ;;
    *) stop "unknown argument $1 (use --plan, --prepare, --go, --summary, --stage sonnet|opus)" ;;
  esac
  shift
done
case "$MODE" in --go|--prepare) [ -n "$STAGE" ] || stop "$MODE needs --stage sonnet or opus" ;; esac

# Sets MODEL, RUN_CAP, CAP and USD (expected a run) of a stage.
stage_conf() {
  case "$1" in
    sonnet) MODEL=us.anthropic.claude-sonnet-5-5; RUN_CAP=1; CAP=16; USD=$SONNET_USD ;;
    opus) MODEL=us.anthropic.claude-opus-5-5; RUN_CAP=2; CAP=32; USD=$(awk -v s="$SONNET_USD" -v f="$OPUS_FACTOR" 'BEGIN { print s * f }') ;;
    *) stop "unknown stage $1 (sonnet or opus)" ;;
  esac
}

# run-cc-compare.sh for one stage, with its arm, model, caps and root.
compare() {
  local st=$1; shift
  stage_conf "$st"
  CC_MODEL=$MODEL CC_ARMS=cc-konductor=$KONDUCTOR_SHA CC_CAP_USD=$CAP CC_RUN_CAP_USD=$RUN_CAP ROOT=$CCM_ROOT/$st \
    bash "$HERE0/run-cc-compare.sh" "$@"
}

reused() { ls "$CC_COMPARE_ROOT/runs" 2>/dev/null | grep -c '[.]done$' || true; }

# cc-skill-loads.js over one runs dir, or "no runs yet". Skill sizes come from the arm's installed tree in that cache.
loads() {
  local label=$1 runs=$2 cache=$3 skills
  if [ -z "$(find "$runs" -name stream.jsonl -not -path '*/workspace/*' 2>/dev/null | head -n 1)" ]; then echo "$label: no runs yet"; return 0; fi
  skills=$(ls -d "$cache"/claude-"${KONDUCTOR_SHA:0:12}"-*/src/dist/claude/skills 2>/dev/null | head -n 1)
  [ -n "$skills" ] || stop "$label: no installed skill tree under $cache"
  echo "## $label"; echo
  node "$HERE0/cc-skill-loads.js" "$runs" "$MANIFEST" "$R" "$skills"
}

case "$MODE" in
  --plan)
    echo "run-cc-compare.sh cc-konductor runs to reuse: $(reused) of 8 tasks ($CC_COMPARE_ROOT/runs); with 8, skip the sonnet stage"
    for st in sonnet opus; do
      stage_conf "$st"
      echo
      echo "stage $st: cc-konductor on $MODEL, $RUNS runs, USD $RUN_CAP a run, cap USD $CAP, expected USD $(awk -v n="$RUNS" -v u="$USD" 'BEGIN { printf "%.2f", n * u }')"
      compare "$st"
    done ;;
  --prepare) compare "$STAGE" --prepare ;;
  --go)
    if [ "$STAGE" = sonnet ] && [ "$(reused)" -gt 0 ]; then
      stop "run-cc-compare.sh has $(reused) task(s) done under $CC_COMPARE_ROOT/runs: reuse its cc-konductor runs (finish that study) instead of a Sonnet stage"
    fi
    compare "$STAGE" --go ;;
  --summary)
    loads "run-cc-compare.sh (Sonnet, reused)" "$CC_COMPARE_ROOT/runs" "$CC_COMPARE_ROOT/cache"
    loads "stage sonnet" "$CCM_ROOT/sonnet/runs" "$CCM_ROOT/sonnet/cache"
    loads "stage opus" "$CCM_ROOT/opus/runs" "$CCM_ROOT/opus/cache" ;;
esac
