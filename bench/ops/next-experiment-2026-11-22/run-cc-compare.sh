#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Claude Code twin of the forced-skills experiment (modelled on run-forced-aa-r2.sh): plain Claude Code (cc-vanilla)
# against Claude Code with konductor (cc-konductor at the frozen konductor ref f5d18459), on the same 8 tasks, at the
# same frozen bench commit 69149846 and task versions, so the results sit beside the Kiro runs. 8 tasks x 2 arms x
# 2 replicates = 32 runs; one bench command per task; tasks with runs-cc/<task>.done are skipped.
#
#   bash run-cc-compare.sh             dry run: each task's budget and the running worst case; no agent, no build
#   bash run-cc-compare.sh --prepare   free: frozen worktree, pinned claude copy, both arms built and trial-installed
#                                      (bench --prepare-only: a konductor build and a no-credential listing probe)
#   CC_AWS_PROFILE=<profile> bash run-cc-compare.sh --go     PAID (USD): rerun to resume
#
# Caps: USD 1 a run (claude's own --max-budget-usd, bench --run-budget-usd) and USD 30 in all (CAP_USD). Before each
# task its --budget-usd is cut so spent + min(runs left x 1, 0.9 x budget + 1) <= 30: the frozen runner starts a run
# while under 90% of --budget-usd, so one command can pass its budget by one run. Expected about USD 0.67 a run (the
# STANDARD Claude Code step), about USD 21 for all 32; the worst case is the cap.
# Each task waits (up to 60 min) for load under LOAD_MAX, a free heavy lock and no other bench run. Work dirs live
# under ROOT (outside HOME; Claude Code would load home .claude skills from a scratch dir under HOME); TMPDIR=/tmp.
# Isolation as the Kiro runs: --isolate unshare, --hide R, seed 20261121, effort high, one run at a time.
# Skill loads: after the runs, node cc-skill-loads.js prints which skills each run loaded and whether in full.
#
# Test hooks: STUB=<cmd> replaces the bench command (the rest of the --go path runs as is) and skips the frozen
# worktree, user-namespace, claude and python checks; HERE, ROOT, R, HEAVY_LOCK, LOAD_MAX, WAIT_PAT override the paths
# and the host checks.
# Study overrides (run-cc-model-swap.sh sets them): CC_MODEL, CC_ARMS, CC_CAP_USD and CC_RUN_CAP_USD replace the model,
# arms, cap and per-run cap; the task budget and the runs a task needs follow the arm count.
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
REPO=$WS/worktrees/konductor-plant
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203      # the forced experiment's frozen bench (LITE plan benchSha)
KONDUCTOR_SHA=f5d184596378ae72ae531d80647548512c14cacf  # the frozen konductor ref (LITE plan konductorSha)
R=${R:-$WS/worktrees/cc-frozen-69149846}                # this study's own frozen worktree; never pilot or lite-frozen
HERE=${HERE:-$WS/reports/next-experiment-2026-11-22}
ROOT=${ROOT:-/var/tmp/cc-compare}
OUT=$ROOT/runs
CACHE=$ROOT/cache
CLAUDE_VERSION=2.1.330.1791
CLAUDE_SRC=$HOME/.toolbox/tools/claude-code/$CLAUDE_VERSION/claude
CLAUDE_PIN=f390eaa0814e6a1bff74cbb47acb74cb9c89d30ced809fe0af5af00c7bfe8ebb
CLAUDE_BIN=$ROOT/bin/$CLAUDE_VERSION/claude              # a copy, so a toolbox update cannot change the binary mid-study
MODEL=${CC_MODEL:-us.anthropic.claude-sonnet-5-5}       # the Kiro arms' claude-sonnet-5.5, by its Bedrock id
ARMS=${CC_ARMS:-cc-vanilla,cc-konductor=$KONDUCTOR_SHA}
REPS=2
CAP_USD=${CC_CAP_USD:-30}
RUN_CAP_USD=${CC_RUN_CAP_USD:-1}
NARMS=$(echo "$ARMS" | tr ',' '\n' | grep -c .)
TASK_BUDGET=$(awk -v a="$NARMS" -v r="$REPS" -v l="$RUN_CAP_USD" 'BEGIN { print a * r * l }')   # arms x replicates x one run
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
LOAD_MAX=${LOAD_MAX:-4}
WAIT_PAT=${WAIT_PAT:-bench/runner/bench[.]js run}
STUB=${STUB:-}
MODE=${1:-}
DRY_SPENT=0
say() { echo "[$(date -u +%H:%M)] $*"; }
stop() { echo "stop: $*" >&2; exit 1; }

# task batch version (versions: prefixes/manifest.json, frozen at 69149846)
TASKS='t8-dec-deploy-strategy t8 4
t5-qa-checkout-strategy t5 2
t5-qa-sync-strategy t5 2
t6-req-field-inspections t6 5
t2-dr-notify-fanout t2 3
t2-arch-dr-split-checkout t2 3
t7-program-brief t7 5
t1-nfr-report-queries t1 3'

# The frozen worktree: made on --prepare or --go; refused at another commit or with local changes.
check_frozen() {
  if [ -e "$R" ]; then
    [ "$(git -C "$R" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$R is not at $BENCH_SHA"
    [ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes"
  elif [ -n "$MODE" ]; then
    git -C "$REPO" worktree add --detach "$R" "$BENCH_SHA" >/dev/null || stop "cannot add $R"
  fi
}

# The pinned claude binary, copied under ROOT on --prepare or --go.
check_claude() {
  local have=$CLAUDE_BIN
  if [ ! -x "$CLAUDE_BIN" ]; then
    have=$CLAUDE_SRC
    [ -x "$CLAUDE_SRC" ] || stop "no $CLAUDE_BIN and no $CLAUDE_SRC"
  fi
  [ "$(sha256sum "$have" | cut -d' ' -f1)" = "$CLAUDE_PIN" ] || stop "$have is not the pinned claude $CLAUDE_VERSION"
  if [ "$have" = "$CLAUDE_SRC" ] && [ -n "$MODE" ]; then
    mkdir -p "$(dirname "$CLAUDE_BIN")" && cp -- "$CLAUDE_SRC" "$CLAUDE_BIN" || stop "cannot copy claude to $CLAUDE_BIN"
    [ "$(sha256sum "$CLAUDE_BIN" | cut -d' ' -f1)" = "$CLAUDE_PIN" ] || stop "the copy $CLAUDE_BIN does not match the pin"
  fi
}

# Each task's version in the frozen worktree must be the manifest's (and the forced runs') version.
check_versions() {
  local task=$1 batch=$2 want=$3 got
  got=$(git -C "$REPO" show "$BENCH_SHA:bench/scenarios/$batch/$task.json" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>console.log(JSON.parse(s).version))') \
    || stop "cannot read $task at $BENCH_SHA"
  [ "$got" = "$want" ] || stop "$task is version $got at $BENCH_SHA, the forced runs used $want"
}

# USD spent under OUT: each run's result.json costUsd; a run with a stream but no cost counts its full cap.
spent_all() {
  node -e 'const fs=require("fs"), p=require("path"); const [root, cap]=[process.argv[1], Number(process.argv[2])]; let s=0;
    const walk=(d)=>{ let es; try { es=fs.readdirSync(d,{withFileTypes:true}) } catch { return }
      const names=es.map((e)=>e.name);
      if (names.includes("stream.jsonl") || names.includes("result.json")) {
        let c=null; try { c=JSON.parse(fs.readFileSync(p.join(d,"result.json"),"utf8")).costUsd } catch {}
        s += Number.isFinite(c) ? c : cap; return }
      for (const e of es) if (e.isDirectory() && e.name!=="workspace") walk(p.join(d,e.name)) };
    walk(root); console.log(s.toFixed(2))' "$OUT" "$RUN_CAP_USD"
}

# Finished runs (result.json) of one task.
runs_done() { find "$OUT/$1" -name result.json -not -path '*/workspace/*' 2>/dev/null | wc -l; }

# Budget for one task: max(own budget, one run), cut so spent + 0.9 x budget + one run <= CAP. STOP: one run won't fit.
budget_for() {
  awk -v s="$1" -v c="$CAP_USD" -v l="$RUN_CAP_USD" -v b="$TASK_BUDGET" 'BEGIN { if (b < l) b = l; m = (c - s - l) / 0.9;
    if (m < b) b = m; if (b < l) print "STOP"; else printf "%.2f", b }'
}
# Worst case after a task: spent + min(runs left x one run, 0.9 x budget + one run).
worst_case() {
  awk -v s="$1" -v b="$2" -v n="$3" -v l="$RUN_CAP_USD" 'BEGIN { w = 0.9 * b + l; if (n * l < w) w = n * l; printf "%.2f", s + w }'
}

# Wait (up to 60 min) for load under LOAD_MAX, a free heavy lock and no other bench run.
wait_host() {
  local i=0 l
  while :; do
    l=$(cut -d' ' -f1 /proc/loadavg)
    if awk -v l="$l" -v m="$LOAD_MAX" 'BEGIN { exit !(l < m) }' && flock -n "$HEAVY_LOCK" true && ! pgrep -f "$WAIT_PAT" >/dev/null; then return 0; fi
    i=$((i + 1)); [ "$i" -le 60 ] || stop "load $l, heavy lock or another bench run busy for 60 min"
    sleep 60
  done
}

# The bench argument list of one task (without --budget-usd, --out and --resume).
bench_args() {
  local task=$1 batch=$2
  BENCH=(node "$R/bench/runner/bench.js" run --suite pilot --tasks "$task" --arms "$ARMS" --replicates "$REPS" --parallel 1
    --extra-tasks "$R/bench/scenarios/$batch" --repo-root "$R" --hide "$R" --isolate unshare --seed 20261121
    --claude-bin "$CLAUDE_BIN" --model "$MODEL" --effort high --run-budget-usd "$RUN_CAP_USD" --python "$PY312" --cache "$CACHE")
}

# Runs (or with no mode, prints) one task. Dry-run spend is the running worst case.
run_task() {
  local task=$1 batch=$2 version=$3 s=0 budget left rc=0 n
  local -a resume=()
  check_versions "$task" "$batch" "$version"
  [ -e "$OUT/$task.done" ] && { echo "$task: done, skipped"; return 0; }
  n=$(runs_done "$task"); left=$((NARMS * REPS - n))
  if [ "$MODE" = --go ]; then
    if [ -e "$OUT/$task" ]; then
      [ -f "$OUT/$task/run-config.json" ] || stop "$OUT/$task exists with no run-config.json: check it by hand"
      resume=(--resume)
    fi
    wait_host; s=$(spent_all)
  else s=$DRY_SPENT; fi
  budget=$(budget_for "$s")
  [ "$budget" = STOP ] && stop "spent USD $s of $CAP_USD: $task cannot fit one run of USD $RUN_CAP_USD"
  echo "| $task | $left | $s | $budget | $(worst_case "$s" "$budget" "$left") |"
  bench_args "$task" "$batch"
  if [ "$MODE" != --go ]; then DRY_SPENT=$(worst_case "$s" "$budget" "$left"); return 0; fi
  mkdir -p "$OUT"
  # </dev/null: the task list is on this loop's stdin, and the command must not read it.
  if [ -n "$STUB" ]; then $STUB "${BENCH[@]}" --aws-profile "$CC_AWS_PROFILE" --budget-usd "$budget" --out "$OUT/$task" "${resume[@]}" </dev/null || rc=$?
  else nice -n 10 "${BENCH[@]}" --aws-profile "$CC_AWS_PROFILE" --budget-usd "$budget" --out "$OUT/$task" "${resume[@]}" </dev/null >> "$OUT/$task.log" 2>&1 || rc=$?; fi
  [ "$rc" = 0 ] || stop "$task exited $rc (log $OUT/$task.log); rerun to resume"
  n=$(runs_done "$task")
  [ "$n" -ge $((NARMS * REPS)) ] || stop "$task: $n of $((NARMS * REPS)) runs finished (budget skips?); rerun to resume"
  touch "$OUT/$task.done"
}

main() {
  local t b v po rc=0
  case "$MODE" in ''|--prepare|--go) ;; *) echo "usage: bash $0 [--prepare|--go]"; exit 64 ;; esac
  case "$(realpath -m -- "$ROOT")/" in "$(realpath -m -- "$HOME")"/*) stop "ROOT $ROOT is under HOME; work dirs go outside it" ;; esac
  export TMPDIR=/tmp   # bench refuses a Claude Code scratch dir under HOME (home .claude skills would load)
  PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
  if [ -z "$STUB" ]; then
    check_frozen
    check_claude
    [ -n "$PY312" ] || stop "no python 3.12"
  fi
  if [ "$MODE" = --go ]; then
    [ -n "${CC_AWS_PROFILE:-}" ] || stop "a paid run needs CC_AWS_PROFILE, the AWS profile whose keys claude may use"
    [ -n "$STUB" ] || unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them): run from your own terminal"
  fi
  if [ "$MODE" = --prepare ]; then
    wait_host
    mkdir -p "$ROOT"
    po=$(mktemp -d "$ROOT/prep.XXXXXX")
    bench_args t8-dec-deploy-strategy t8
    nice -n 10 "${BENCH[@]}" --budget-usd "$CAP_USD" --out "$po" --prepare-only || rc=$?
    rmdir -- "$po" 2>/dev/null || true
    [ "$rc" = 0 ] && say "prepare-only passed: both arms built, no agent started" || say "prepare-only FAILED (exit $rc)"
    exit "$rc"
  fi
  [ "$MODE" = --go ] || { DRY_SPENT=$(spent_all); echo "Dry run: worst case assumes every run spends its USD $RUN_CAP_USD cap. Arms $ARMS, $REPS replicates."; }
  echo "| task | runs left | spent before (USD) | --budget-usd | worst case after |"
  echo "| --- | --- | --- | --- | --- |"
  # Not a pipe: the loop must run in this shell so DRY_SPENT carries from task to task.
  while read -r t b v; do run_task "$t" "$b" "$v"; done <<EOF
$TASKS
EOF
  if [ "$MODE" = --go ]; then say "all tasks done, spent USD $(spent_all) of $CAP_USD"; else echo "bench command per task, for example:"; echo "  ${BENCH[*]} --aws-profile \$CC_AWS_PROFILE --budget-usd <above> --out $OUT/<task>"; fi
}
main "$@"
