#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# claude-standard.sh: the Claude Code arms of STANDARD, after run-standard.sh and before judge-standard.sh: the frozen
# plan's tasks and batches, run through Claude Code under the same conditions as the Kiro arms. Owner terminal only:
# paid (USD, Bedrock keys of CC_AWS_PROFILE).
#
#   S=<study dir> R=<worktree> bash claude-standard.sh --plan           free: arms, batches, runs, expected USD per
#                                                                       stage, caps; reads the plan only, no bench call
#   S=<study dir> R=<worktree> bash claude-standard.sh --prepare-only   free: every arm prepared by bench (a
#                                                                       konductor build and a trial install); no agent
#   S=<study dir> R=<worktree> CC_AWS_PROFILE=<profile> bash claude-standard.sh   the paid stages; rerun to resume
#
# Arms (helper.js cc-plan): cc-vanilla (plain Claude Code), cc-konductor=<the plan's konductor sha>,
# cc-konductor-noskills=dir:<the plan's noskills tree> and cc-konductor-list=dir:<the plan's list tree>, the same
# conditions as the Kiro arms under the cc- prefix. The list tree carries the Kiro skill-list hook's text as a Claude
# Code rules file (.bench-claude-rules/skill-list.md, cap/nudge.js); the Claude Code plugin copies it into the run
# HOME's ~/.claude/rules, which Claude Code loads at session start (https://code.claude.com/docs/en/memory). The plain
# arm gets the empty rules file only.
# The konductor arms follow konductor's own Claude Code guide (D-241): `konductor install --harness claude` into the
# run HOME, `claude -p --agent konductor`, team mode on and the guide's permission list in the run settings
# (bench/plugins/claude-code/team-mode.js). Under `claude -p` no teammate spawns, so team mode changes no run.
# Stages as the Kiro kit: stage N is replicate N of every batch (CC_STAGES, default STAGES or 2), each capped at
# CC_STAGE_CAP_USD (110) with RUN_CAP_USD (1.5) a run (claude's own --max-budget, bench --run-budget-usd). Before each
# batch, what the stage cap leaves minus one run's cap is the batch's --budget-usd, so bench's own USD guard checks it
# before every run, and a batch that cannot fit one run stops the step cleanly. The next stage starts only on a clean
# one (helper.js stage over the cc- arms: 10% or less broken per arm, every arm ran). Units live under
# $S/claude/runs/r<stage>/<batch>, the shape judge-standard.sh reads. Expected USD: helper.js cc-plan (the measured
# USD 0.071 a plain Kiro credit, konductor 1.59x, noskills 1.3x, list 1.7x), about USD 74 a stage for 42 tasks over four arms.
# S must be outside HOME. Never beside a pilot, a forced-small run, another bench run or a held heavy lock.
#
# Needs: S, R (as run-standard.sh). Optional: CC_CLAUDE_BIN, CC_MODEL, CC_ARMS (replaces the three), CC_ISOLATE,
# CC_STAGES, CC_STAGE_CAP_USD, RUN_CAP_USD. Test overrides: HELPER, HEAVY_LOCK, HOST_CHECK, WAIT_MAX, WAIT_STEP.
set -u

KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=${S:-}
R=${R:-}
SH=${HELPER:-$KIT/helper.js}
MODEL=${CC_MODEL:-us.anthropic.claude-sonnet-5-5}
STAGES=${CC_STAGES:-${STAGES:-2}}
STAGE_CAP=${CC_STAGE_CAP_USD:-110}
RUN_CAP_USD=${RUN_CAP_USD:-1.5}
ISOLATE=${CC_ISOLATE:-unshare}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
WAIT_MAX=${WAIT_MAX:-3600}; WAIT_STEP=${WAIT_STEP:-60}
SEED=20261121
CC=$ROOT/claude
CCPLAN=$CC/cc-plan.json
CLAUDE=""
STOPPED=""
ARMS=""; ARM_IDS=""; BATCHES=""; PLAN=""
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }
q() { node -p "const p=require('$CCPLAN'); $1"; }

busy() {
  flock -n "$HEAVY_LOCK" true 2>/dev/null || { echo "the heavy lock $HEAVY_LOCK is held"; return 0; }
  [ "${HOST_CHECK:-1}" = 0 ] && return 1
  pgrep -f 'run-pilot|run-forced|pilot-wave[.]sh' >/dev/null && { echo "a pilot or forced-small script is running"; return 0; }
  pgrep -f 'bench/runner/bench[.]js run' >/dev/null && { echo "another bench.js run is running"; return 0; }
  awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN { exit !(l >= 4) }' && { echo "load $(cut -d' ' -f1 /proc/loadavg) is 4 or more"; return 0; }
  return 1
}
wait_quiet() {
  local waited=0 why=""
  while why=$(busy); do
    if [ "$waited" -ge "$WAIT_MAX" ]; then STOPPED="$why for ${waited}s; rerun this command later (it resumes)"; return 1; fi
    say "waiting: $why (waited ${waited}s)"; sleep "$WAIT_STEP"; waited=$((waited + WAIT_STEP))
  done
  return 0
}
# usd_stage REP: USD spent by the runs of stage REP (result.json costUsd).
usd_stage() { node "$SH" usd-spent "$R" "$CC/runs/r$1"; }
base_args() { # base_args TASKS
  printf '%s\n' run --suite pack --tasks "$1" --arms "$ARMS" --parallel 1 --repo-root "$R" --hide "$R" --isolate "$ISOLATE" \
    --seed "$SEED" --claude-bin "$CLAUDE" --model "$MODEL" --effort high --run-budget-usd "$RUN_CAP_USD"
}
# run_batch REP B: one batch of one stage. Sets STOPPED to stop the step.
run_batch() {
  local rep=$1 b=$2 U=$CC/runs/r$1/$2 spent left rc=0
  local -a A=()
  spent=$(usd_stage "$rep")
  left=$(awk -v s="$spent" -v c="$STAGE_CAP" -v w="$RUN_CAP_USD" 'BEGIN { x = c - s - w; if (x < w) print "STOP"; else printf "%.2f", x }')
  if [ "$left" = STOP ]; then STOPPED="stage cap reached before r$rep $b: USD $spent spent in stage $rep, cap $STAGE_CAP, one run may cost $RUN_CAP_USD"; return 0; fi
  wait_quiet || return 0
  aws sts get-caller-identity --profile "$CC_AWS_PROFILE" > /dev/null 2>&1 || { STOPPED="AWS credentials for profile $CC_AWS_PROFILE expired before r$rep $b"; return 0; }
  mapfile -t A < <(base_args "$(q "p.batches['$b'].tasks.join(',')")")
  A+=(--replicates 1 --replicate-offset $((rep - 1)) --aws-profile "$CC_AWS_PROFILE" --budget-usd "$left" --out "$U")
  if [ -f "$U/run-config.json" ]; then A+=(--resume)
  elif [ -e "$U" ]; then mv -- "$U" "$CC/incomplete/r$rep-$b.$(date +%s)"; fi
  say "r$rep $b: start, batch guard USD $left (stage $rep spent USD $spent of $STAGE_CAP)"
  mkdir -p "$CC/runs/r$rep"
  nice -n 10 node "$R/bench/runner/bench.js" "${A[@]}" >> "$U.log" 2>&1; rc=$?
  node "$R/bench/runner/bench.js" scenarios pilot-table "$U" > "$CC/tables/r$rep-$b.md" 2>> "$U.log"
  say "r$rep $b: exit $rc, stage $rep spent USD $(usd_stage "$rep"); table claude/tables/r$rep-$b.md"
  case "$rc" in
    0) touch "$U.done" ;;
    3) STOPPED="r$rep $b: bench USD guard stopped the batch (exit 3); stage cap reached" ;;
    *) STOPPED="r$rep $b: bench exit $rc (see $U.log); rerun to resume" ;;
  esac
  return 0
}

main() {
  local mode=${1:-} prep=0 plan_only=0 bench_sha po rc=0 rep b
  local -a dirs=()
  case "$mode" in '') ;; --prepare-only) prep=1 ;; --plan) plan_only=1 ;; *) echo "usage: S=DIR R=WORKTREE bash $0 [--plan|--prepare-only]"; exit 64 ;; esac
  [ -n "$ROOT" ] && [ -n "$R" ] || stop "set S (the study dir) and R (the STANDARD worktree)"
  case "$(realpath -m -- "$ROOT")/" in "$(realpath -m -- "$HOME")"/*) stop "$ROOT is under HOME; work dirs go outside it, for example under /var/tmp" ;; esac
  PLAN=$ROOT/plan.json
  # The free modes may use run-standard.sh --prepare-only's preview; the paid step needs the frozen plan.
  [ ! -s "$PLAN" ] && [ "$mode" != '' ] && PLAN=$ROOT/prepare/plan-preview.json
  [ -s "$PLAN" ] || stop "no $PLAN: run run-standard.sh first (a paid start freezes the plan; --prepare-only writes a preview)"
  mkdir -p "$CC"
  if [ "$mode" = '' ] && [ -s "$CCPLAN" ]; then :   # a paid rerun keeps the arms it started with
  else node "$SH" cc-plan "$R" "$PLAN" > "$CCPLAN.new" || stop "cc-plan failed"; mv -f -- "$CCPLAN.new" "$CCPLAN"; fi
  ARMS=${CC_ARMS:-$(q 'p.arms.join(",")')}
  ARM_IDS=$(q 'p.armIds.join(",")')
  BATCHES=$(q 'Object.keys(p.batches).join(" ")')
  bench_sha=$(node -p 'require(process.argv[1]).benchSha' "$PLAN")
  say "Claude Code arms: $ARMS; model $MODEL; $STAGES stage(s) at USD $STAGE_CAP each, USD $RUN_CAP_USD a run"
  say "tasks: $(q 'Object.values(p.batches).reduce((n,b)=>n+b.tasks.length,0)') in $(q 'Object.keys(p.batches).length') batches; $(q 'p.runsPerStage') runs a stage; expected USD $(q 'p.expectedUsdPerStage') a stage (USD $(q 'p.usdPerPlainCredit') a plain Kiro credit; arm ratios $(q 'Object.entries(p.ratio).map(([a,r])=>a.slice(3)+" "+r+"x").join(", ")'))"
  if [ "$plan_only" = 1 ]; then
    q 'Object.entries(p.batches).map(([b,x])=>"  "+b+": "+x.tasks.length+" task(s), expected USD "+x.expectedUsd).join("\n")'
    say "plan only: no bench call. Dry run: bash $0 --prepare-only; paid: CC_AWS_PROFILE=<profile> bash $0"
    exit 0
  fi
  export TMPDIR=/tmp   # bench refuses a Claude Code scratch dir under HOME (home .claude skills would load)
  [ "$(git -C "$R" rev-parse HEAD)" = "$bench_sha" ] || stop "$R is not at the plan's bench commit ${bench_sha:0:8}"
  CLAUDE=${CC_CLAUDE_BIN:-$(ls -d "$HOME"/.toolbox/tools/claude-code/*/claude 2>/dev/null | sort -V | tail -1)}
  [ -x "${CLAUDE:-}" ] || stop "no claude binary (set CC_CLAUDE_BIN to <tools>/claude-code/<version>/claude)"
  wait_quiet || stop "$STOPPED"

  if [ "$prep" = 1 ]; then
    local -a A=()
    mapfile -t A < <(base_args "$(q 'Object.values(p.batches).flatMap(b=>b.tasks).join(",")')")
    po=$(mktemp -d /var/tmp/konductor-standard-cc-prep.XXXXXX)
    nice -n 10 node "$R/bench/runner/bench.js" "${A[@]}" --replicates 1 --budget-usd "$STAGE_CAP" --out "$po" --prepare-only || rc=$?
    rmdir -- "$po" 2>/dev/null
    if [ "$rc" = 0 ]; then say "prepare-only passed (no agent started). Paid step: CC_AWS_PROFILE=<profile> bash $0"; else say "prepare-only FAILED (exit $rc)"; fi
    exit "$rc"
  fi

  [ -n "${CC_AWS_PROFILE:-}" ] || stop "a paid run needs CC_AWS_PROFILE, the AWS profile whose keys claude may use"
  mkdir -p "$CC/runs" "$CC/tables" "$CC/incomplete"
  for rep in $(seq 1 "$STAGES"); do
    [ -z "$STOPPED" ] || break
    if [ "$rep" -gt 1 ]; then
      mapfile -t dirs < <(find "$CC/runs/r$((rep - 1))" -mindepth 1 -maxdepth 1 -type d | sort)
      node "$SH" stage "$R" --arms "$ARM_IDS" "${dirs[@]}" | tee "$CC/tables/stage-$((rep - 1))-check.txt"
      [ "${PIPESTATUS[0]}" = 0 ] || { STOPPED="stage $((rep - 1)) is not clean (see claude/tables/stage-$((rep - 1))-check.txt); stage $rep not started"; break; }
    fi
    for b in $BATCHES; do
      [ -e "$CC/runs/r$rep/$b.done" ] && { say "r$rep $b: done, skipped"; continue; }
      run_batch "$rep" "$b"
      [ -z "$STOPPED" ] || break
    done
  done

  mapfile -t dirs < <(find "$CC"/runs/r* -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort)
  if [ "${#dirs[@]}" -gt 0 ]; then
    node "$SH" summary "$R" --arms "$ARM_IDS" "$CC/tables/code-gap.md" "${dirs[@]}"
    node "$R/bench/runner/bench.js" scenarios pilot-table "${dirs[@]}" > "$CC/tables/all-runs.md" 2>/dev/null
  fi
  say "${STOPPED:-all Claude Code units finished}"
  for rep in $(seq 1 "$STAGES"); do say "stage $rep: USD $(usd_stage "$rep") of $STAGE_CAP"; done
  say "tables: $CC/tables (code-gap.md: the cc- arms per task; all-runs.md; r<rep>-<batch>.md)"
  say "next (judges over the Kiro and Claude Code units): S=$ROOT R=$R bash $KIT/judge-standard.sh --plan"
  [ -z "$STOPPED" ]
}
main "$@"
