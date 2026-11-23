#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# claude-standard.sh: the Claude Code step of STANDARD (plan P8): 15 tasks, one run each per arm, after run-standard.sh.
# Owner terminal only: paid (USD, Bedrock keys of CC_AWS_PROFILE).
#
#   S=<study dir> R=<worktree> bash claude-standard.sh --prepare-only   free: task pick, both arms prepared; no agent
#   S=<study dir> R=<worktree> CC_AWS_PROFILE=<profile> bash claude-standard.sh   the paid step; rerun to resume
#
# Tasks: helper.js cc-tasks over the frozen STANDARD plan (the bench's LITE picks that STANDARD runs, then the
# rest by lowest SR-32 hash), frozen in $ROOT/claude/tasks.txt on the first paid start. Arms: cc-vanilla and
# cc-konductor=<the plan's konductor sha> (CC_ARMS). Caps: USD 1 per run (claude's own --max-budget, bench
# --run-budget-usd) and USD 30 in all (CAP_USD): bench's --budget-usd is what the cap leaves after the spend already
# under $ROOT/claude/runs minus one run's cap, so a resumed step cannot pass the cap by what it spent before.
# S must be outside HOME. Never beside a pilot, a forced-small run or a held heavy lock: it stops instead.
#
# Needs: S, R (as run-standard.sh). Optional: CC_CLAUDE_BIN, CC_MODEL, CC_ARMS, N_TASKS, CC_ISOLATE. Test overrides:
# HELPER, CAP_USD, RUN_CAP_USD, HEAVY_LOCK, HOST_CHECK.
set -u

KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=${S:-}
R=${R:-}
SH=${HELPER:-$KIT/helper.js}
MODEL=${CC_MODEL:-us.anthropic.claude-sonnet-5-5}
CAP_USD=${CAP_USD:-30}
RUN_CAP_USD=${RUN_CAP_USD:-1}
N_TASKS=${N_TASKS:-15}
ISOLATE=${CC_ISOLATE:-unshare}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
CC=$ROOT/claude
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { say "STOP: $*"; exit 1; }

host_free() {
  flock -n "$HEAVY_LOCK" true 2>/dev/null || { echo "the heavy lock $HEAVY_LOCK is held"; return 1; }
  [ "${HOST_CHECK:-1}" = 0 ] && return 0
  pgrep -f 'run-pilot|run-forced' >/dev/null && { echo "a pilot or forced-small script is running"; return 1; }
  pgrep -f 'bench/runner/bench[.]js run' >/dev/null && { echo "another bench.js run is running"; return 1; }
  return 0
}

main() {
  local prep=0 plan sha bench_sha claude tasks arms spent left why out po rc=0
  local -a auth=() A=()
  case "${1:-}" in '') ;; --prepare-only) prep=1 ;; *) echo "usage: S=DIR R=WORKTREE bash $0 [--prepare-only]"; exit 64 ;; esac
  [ -n "$ROOT" ] && [ -n "$R" ] || stop "set S (the study dir) and R (the STANDARD worktree)"
  case "$(realpath -m -- "$ROOT")/" in "$(realpath -m -- "$HOME")"/*) stop "$ROOT is under HOME; work dirs go outside it, for example under /var/tmp" ;; esac
  plan=$ROOT/plan.json
  # The dry run may use run-standard.sh --prepare-only's preview; the paid step needs the frozen plan.
  [ ! -s "$plan" ] && [ "$prep" = 1 ] && plan=$ROOT/prepare/plan-preview.json
  [ -s "$plan" ] || stop "no $plan: run run-standard.sh first (a paid start freezes the plan; --prepare-only writes a preview)"
  why=$(host_free) || stop "$why; rerun later"
  export TMPDIR=/tmp   # bench refuses a Claude Code or judge scratch dir under HOME (home .claude skills would load)
  sha=$(node -p 'require(process.argv[1]).konductorSha' "$plan")
  bench_sha=$(node -p 'require(process.argv[1]).benchSha' "$plan")
  [ "$(git -C "$R" rev-parse HEAD)" = "$bench_sha" ] || stop "$R is not at the plan's bench commit ${bench_sha:0:8}"
  arms=${CC_ARMS:-cc-vanilla,cc-konductor=$sha}
  claude=${CC_CLAUDE_BIN:-$(ls -d "$HOME"/.toolbox/tools/claude-code/*/claude 2>/dev/null | sort -V | tail -1)}
  [ -x "${claude:-}" ] || stop "no claude binary (set CC_CLAUDE_BIN to <tools>/claude-code/<version>/claude)"
  mkdir -p "$CC"
  if [ -s "$CC/tasks.txt" ]; then tasks=$(cat "$CC/tasks.txt")
  else tasks=$(node "$SH" cc-tasks "$R" "$plan" "$N_TASKS") || stop "task pick failed"; fi
  [ -n "$tasks" ] || stop "no Claude Code tasks picked"
  say "Claude Code tasks ($(tr ',' '\n' <<< "$tasks" | wc -l)): $tasks"
  say "arms $arms; model $MODEL; caps USD $RUN_CAP_USD per run, USD $CAP_USD in all"
  A=(run --suite pack --tasks "$tasks" --arms "$arms" --replicates 1 --parallel 1 --repo-root "$R" --hide "$R"
    --isolate "$ISOLATE" --seed 20261121 --claude-bin "$claude" --model "$MODEL" --effort high --run-budget-usd "$RUN_CAP_USD")

  if [ "$prep" = 1 ]; then
    po=$(mktemp -d /var/tmp/konductor-standard-cc-prep.XXXXXX)
    nice -n 10 node "$R/bench/runner/bench.js" "${A[@]}" --budget-usd "$CAP_USD" --out "$po" --prepare-only || rc=$?
    rmdir -- "$po" 2>/dev/null
    if [ "$rc" = 0 ]; then say "prepare-only passed (no agent started). Paid step: CC_AWS_PROFILE=<profile> bash $0"; else say "prepare-only FAILED (exit $rc)"; fi
    exit "$rc"
  fi

  [ -n "${CC_AWS_PROFILE:-}" ] || stop "a paid run needs CC_AWS_PROFILE, the AWS profile whose keys claude may use"
  auth=(--aws-profile "$CC_AWS_PROFILE")
  [ -s "$CC/tasks.txt" ] || printf '%s\n' "$tasks" > "$CC/tasks.txt"
  out=$CC/runs
  spent=$(node "$SH" usd-spent "$R" "$out")
  left=$(awk -v s="$spent" -v c="$CAP_USD" -v w="$RUN_CAP_USD" 'BEGIN { x = c - s - w; if (x < w) print "STOP"; else printf "%.2f", x }')
  [ "$left" = STOP ] && stop "spent USD $spent of the USD $CAP_USD cap; less than one more run's cap is left"
  [ -e "$out.done" ] && { say "the Claude Code step is done (USD $spent)"; exit 0; }
  [ -f "$out/run-config.json" ] && A+=(--resume)
  say "PAID: spent USD $spent so far; this command's guard USD $left"
  nice -n 10 node "$R/bench/runner/bench.js" "${A[@]}" "${auth[@]}" --budget-usd "$left" --out "$out" >> "$CC/run.log" 2>&1 || rc=$?
  spent=$(node "$SH" usd-spent "$R" "$out")
  say "exit $rc; Claude Code spend USD $spent of $CAP_USD; log $CC/run.log"
  [ "$rc" = 0 ] || stop "bench exit $rc (see $CC/run.log); rerun to resume"
  touch "$out.done"
  node "$R/bench/runner/bench.js" scenarios pilot-table "$out" > "$CC/table.md" 2>/dev/null
  say "table: $CC/table.md (code scores; these runs are not judged by run-standard-judge.sh)"
}
main "$@"
