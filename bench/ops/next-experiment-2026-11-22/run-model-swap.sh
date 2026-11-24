#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
# Model-swap run: is konductor's low skill use (a task skill in 7 of 102 natural LITE runs) a Claude Sonnet 5.5 trait?
# The same frozen LITE setup as run-nudge.sh (bench 69149846, konductor f5d18459, kiro-cli 3.5.0, effort high, engine v3,
# seed 20261121, --isolate unshare), with only the model changed. Three stages, each with its own cap and folder:
#
#   natural  plain konductor arm (no hook, no prefix) on claude-opus-5.5, the 8 tasks x 3 replicates, cap 400
#   list     the frozen list-hook arm of run-nudge.sh on claude-opus-5.5, the 4 skill-heavy tasks x 3, cap 220 (optional)
#   fable    plain konductor arm on claude-fable-5.1, the 4 skill-heavy tasks x 2, cap 400 (optional, 6x rate)
#
# The Sonnet 5.5 baseline is not run again. It is reused: the LITE run's konductor cells for the same 8 tasks (24 runs,
# runs/r<rep>/<batch>/konductor/<task>/<rep>) and, for the list stage, run-nudge.sh's konductor-list cells.
#
#   sh run-model-swap.sh [--plan] [--stage S]   free dry run: checks, reused cells, per-task budget, expected and worst case
#   sh run-model-swap.sh --go --stage S         PAID run of one stage (approve its cap first). Resumable, setsid-safe.
#   sh run-model-swap.sh --summary              free: skill-load table per model and arm -> runs-model-swap/summary.md
#
# Spend is counted at 15 credits a run at least (a run with no credit figure counts its limit). A task starts only if
# counted spend + 0.9 x budget + one run's limit stays under the stage cap (the frozen runner starts a run while a command
# is under 90% of --budget-credits). Real spend is never above counted spend, so a stage never passes its cap.
# Tasks with <stage>/<task>.done are skipped; a task folder without .done is run again with --resume. After each task,
# `cap nudge-check` writes <task>.check.md (and stops the list stage if a run lacks the hook text), and a run whose
# result flags a model mismatch stops the stage.
#
# Test hooks: STUB=<cmd> replaces the paid bench command and skips the user-namespace check; HERE=<dir> points at a copy of
# this folder; LITE=<dir> is the reused LITE run; OTHER_PAT=<pattern> is the process pattern of runs to wait for;
# LOAD_MAX, HEAVY_LOCK as in run-nudge.sh; CAP=<n> overrides the stage cap; LIST_TREE=<dir> and SKIP_ARM_CHECK=1 replace
# the pinned list arm; CHECK_BENCH=<dir> is the checkout whose cap nudge-check runs (default: the one holding this script).
set -eu
: "${KONDUCTOR_WS:?set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)}"
WS=$KONDUCTOR_WS
CHECK_BENCH=${CHECK_BENCH:-$(cd "$(dirname "$0")/../../.." && pwd)}
BENCH_SHA=69149846ad65f1016ec386e88ec9043bdec57203       # frozen runner, as in run-nudge.sh
KONDUCTOR_SHA=f5d184596378ae72ae531d80647548512c14cacf   # the LITE konductor arm
R=$WS/worktrees/lite-frozen-69149846                     # read only
HERE=${HERE:-$WS/reports/next-experiment-2026-11-22}
LITE=${LITE:-$WS/reports/lite-run-2026-11-21}
ROOT=$HERE/runs-model-swap
LIST_DIR=/var/tmp/konductor-nudge-arms/variants/konductor-list-4a05c9e54b9f   # run-nudge.sh's pinned list arm
LIST_TREE=${LIST_TREE:-$LIST_DIR/tree}
LIST_HASH=cef75db0b1b3c2bbe3f335606f29929f4a3009f53d69aafee54531b753ffb485
LIST_CMD=72a01fec4ddb020d4c4f3f09da1bed41c43dbec77af12a23a7ff2a8c071be507
KBIN=/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli
KBIN_PIN=e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e
CACHE=/var/tmp/lite-konductor-cache
PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
STUB=${STUB:-}
OTHER_PAT=${OTHER_PAT:-run-nudge.sh|run-forced-aa|run-pilot-v2|run-cc-compare.sh|run-aa-pack.sh}
LOAD_MAX=${LOAD_MAX:-4}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
SKIP_ARM_CHECK=${SKIP_ARM_CHECK:-}
FLOOR=15
MODE=--plan
STAGE=''
CUR=''
stop() { echo "stop: $*" >&2; exit 1; }
. "$(dirname "$0")/lib.sh"   # shared spend and host helpers (D-242)

while [ $# -gt 0 ]; do
  case "$1" in
    --plan|--go|--summary) MODE=$1 ;;
    --stage) [ $# -ge 2 ] || stop "--stage needs natural, list or fable"; STAGE=$2; shift ;;
    *) stop "unknown argument $1 (use --plan, --go, --summary, --stage natural|list|fable)" ;;
  esac
  shift
done
[ "$MODE" != --go ] || [ -n "$STAGE" ] || stop "--go needs --stage natural, list or fable"

# task batch sonnetRunLimit (the LITE batch's per-run cap on Sonnet 5.5)
ALL_TASKS='t8-dec-deploy-strategy t8 23
t5-qa-checkout-strategy t5 23
t5-qa-sync-strategy t5 23
t6-req-field-inspections t6 68
t2-dr-notify-fanout t2 23
t2-arch-dr-split-checkout t2 23
t7-program-brief t7 15
t1-nfr-report-queries t1 23'
# The 4 tasks whose must-load list (prefixes/manifest.json) is longest and where the Sonnet list arm moved loads.
HEAVY=' t8-dec-deploy-strategy t5-qa-checkout-strategy t5-qa-sync-strategy t7-program-brief '

# Sets the stage's arm, model, replicates, task filter and cap.
stage_conf() {
  case "$1" in
    natural) ARM_SPEC="konductor=$KONDUCTOR_SHA"; ARM_ID=konductor; MODEL=claude-opus-5.5; REPS=3; ONLY=''; STAGE_CAP=400 ;;
    list) ARM_SPEC="konductor-list=dir:$LIST_TREE"; ARM_ID=konductor-list; MODEL=claude-opus-5.5; REPS=3; ONLY=$HEAVY; STAGE_CAP=220 ;;
    fable) ARM_SPEC="konductor=$KONDUCTOR_SHA"; ARM_ID=konductor; MODEL=claude-fable-5.1; REPS=2; ONLY=$HEAVY; STAGE_CAP=400 ;;
    *) stop "unknown stage $1 (natural, list or fable)" ;;
  esac
  STAGE_CAP=${CAP:-$STAGE_CAP}
  OUT=$ROOT/$1
  CUR=$1
}

in_stage() { [ -z "$ONLY" ] || case "$ONLY" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# The model's credit rate over Sonnet 5.5's, from the LITE run's kiro-cli model list.
rate_ratio() {
  node -e 'const m=require(process.argv[1]).models; const r=(id)=>{const x=m.find((y)=>y.model_id===id); if(!x) throw new Error(id+" is not in the model list"); return x.rate_multiplier};
    console.log((r(process.argv[2])/r("claude-sonnet-5.5")).toFixed(4))' "$LITE/runs/r1/t8/model-list.json" "$1"
}

# Reused Sonnet cells of one task: the LITE konductor cells, or (list stage) run-nudge.sh's konductor-list cells.
lite_cells() { for r in 1 2 3; do d=$LITE/runs/r$r/$2/konductor/$1/$r; [ -e "$d/result.json" ] && echo "$d"; done; return 0; }
list_cells() { for r in 1 2 3; do d=$HERE/runs-nudge/$1/konductor-list/$1/$r; [ -e "$d/result.json" ] && echo "$d"; done; return 0; }

# Mean credits per run over the given cells' result.json (runs with a credit figure only), or "-".
mean_credits() {
  node -e 'const fs=require("fs"); const c=process.argv.slice(1).map((d)=>JSON.parse(fs.readFileSync(d+"/result.json","utf8")).credits).filter((x)=>typeof x==="number");
    console.log(c.length ? (c.reduce((a,b)=>a+b,0)/c.length).toFixed(2) : "-")' "$@"
}

# Counted spend of a stage: every run that started counts its credits, at least FLOOR; no figure counts its limit.
counted_spent() {
  node -e 'const fs=require("fs"), p=require("path"); const floor=Number(process.argv[2]); let s=0;
    const walk=(d)=>{ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
      if (e.isDirectory() && e.name!=="workspace" && e.name!=="session") walk(p.join(d,e.name));
      else if (e.name==="result.json") { const r=JSON.parse(fs.readFileSync(p.join(d,e.name),"utf8")); if (r.status==="budget_skipped") continue;
        s+=Math.max(floor, typeof r.credits==="number" ? r.credits : (r.creditLimit ?? floor)); } } };
    if (fs.existsSync(process.argv[1])) walk(process.argv[1]); console.log(s.toFixed(2))' "$1" "$FLOOR"
}

ceil_mul() { awk -v a="$1" -v b="$2" 'BEGIN { x = a * b; y = int(x); if (y < x) y++; print y }'; }

check_setup() {
  if [ -e "$R" ]; then
    [ "$(git -C "$R" rev-parse HEAD)" = "$BENCH_SHA" ] || stop "$R is not at $BENCH_SHA"
    [ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes"
  else
    stop "$R is missing: run-forced-aa-r2.sh creates it"
  fi
  [ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_PIN" ] || stop "$KBIN is not the pinned kiro-cli 3.5.0"
  [ -n "$PY312" ] || stop "no python 3.12"
  [ -e "$LITE/runs/r1/t8/model-list.json" ] || stop "$LITE has no model list (the reused LITE run is missing)"
}

# The list arm is run-nudge.sh's, never rebuilt here: variant hash, hook command sha and tree hash must match its pins.
check_list_arm() {
  [ -n "$SKIP_ARM_CHECK" ] && return 0
  [ -e "$LIST_DIR/variant.json" ] || stop "the list arm $LIST_DIR is not built (run-nudge.sh builds it)"
  got=$(node -e 'const v=require(process.argv[1]); const h=v.ops.find((o)=>o.op==="hook"); console.log(v.variantHash+" "+(h?h.commandSha256:"-"))' "$LIST_DIR/variant.json")
  [ "$got" = "$LIST_HASH $LIST_CMD" ] || stop "list arm: variant.json says $got, pinned $LIST_HASH $LIST_CMD"
  got=$(node -e 'console.log(require(process.argv[1]).snapshotDir(process.argv[2]).hash)' "$CHECK_BENCH/bench/runner/lib/arm-source.js" "$LIST_TREE")
  [ "$got" = "$LIST_HASH" ] || stop "list arm: tree hashes to $got, not $LIST_HASH"
  echo "list arm: ok ($LIST_DIR)"
}

# Wait (up to 24 h) until no other paid bench run is running; the plan only reports it.
wait_others() {
  i=0
  while :; do
    pids=$(pgrep -f "$OTHER_PAT" | grep -v "^$$\$" || true)
    [ -z "$pids" ] && return 0
    [ "$MODE" = --go ] || { echo "another paid run is running (pid $(echo $pids)); --go waits for it"; return 0; }
    [ "$i" = 0 ] && echo "[$(date -u +%H:%M)] waiting for another paid run (pid $(echo $pids))"
    i=$((i + 1)); [ "$i" -le 288 ] || stop "another paid run is still running after 24 h"
    sleep 300
  done
}


# After a task: the skill-load check (stops the list stage on a hook miss) and the model check. Sets TASK_STATE to
# done, or open when a cell never ran. Called in this shell (never in $(...)), so its stop ends the script.
after_task() {
  node "$CHECK_BENCH/bench/runner/bench.js" cap nudge-check --run "$OUT/$1" > "$OUT/$1.check.md" \
    || stop "$1: a hook arm ran without its hook text (see $OUT/$1.check.md); fix before the next task"
  node -e 'const fs=require("fs"), p=require("path"); let bad=[];
    const walk=(d)=>{ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
      if (e.isDirectory() && e.name!=="workspace" && e.name!=="session") walk(p.join(d,e.name));
      else if (e.name==="result.json") { const r=JSON.parse(fs.readFileSync(p.join(d,e.name),"utf8")); if ((r.flags??[]).includes("modelMismatch")) bad.push(d); } } };
    walk(process.argv[1]); if (bad.length) { console.error(bad.join("\n")); process.exit(1); }' "$OUT/$1" \
    || stop "$1: a run used another model than $MODEL (model mismatch above)"
  if grep -q '| not run (' "$OUT/$1.check.md"; then TASK_STATE=open; else TASK_STATE=done; fi
}

# One task: run it (--go) or print its plan row. Args: task batch sonnetLimit.
run_task() {
  task=$1; batch=$2; slim=$3; s=0; resume=''; budget=0; after=0; reused=''; src=''; base=0; exp=0; cnt=0
  limit=$(ceil_mul "$slim" "$RATIO")
  own=$(ceil_mul "$((REPS * limit))" 0.6667)
  if [ "$MODE" = --go ]; then
    [ -e "$OUT/$task.done" ] && { echo "$task: done, skipped"; return 0; }
    [ -e "$OUT/$task" ] && { resume=--resume; echo "$task: folder without .done, resuming its unfinished cells"; }
    wait_host
    s=$(counted_spent "$OUT")
  else
    s=$DRY_COUNTED
  fi
  budget=$(budget_for "$s" "$limit" "$own" "$STAGE_CAP")
  if [ "$budget" = STOP ]; then
    [ "$MODE" = --go ] && stop "counted $s of $STAGE_CAP: $task cannot fit one run of $limit"
    printf '| %s | %s | - | - | - | %s | cut | %s | not reached |\n' "$task" "$REPS" "$limit" "$s"
    return 0
  fi
  after=$(worst_case "$s" "$budget" "$limit")
  set -- node "$R/bench/runner/bench.js" run --suite pilot --tasks "$task" --arms "$ARM_SPEC" \
    --replicates "$REPS" --parallel 1 --extra-tasks "$R/bench/scenarios/$batch" --repo-root "$R" --hide "$R" \
    --isolate unshare --seed 20261121 --model "$MODEL" --effort high --agent-engine v3 --kiro-bin "$KBIN" \
    --python "$PY312" --cache "$CACHE" --budget-credits "$budget" --run-credit-limit "$limit" --out "$OUT/$task" $resume
  if [ "$MODE" = --go ]; then
    echo "[$(date -u +%H:%M)] $task: counted $s of $STAGE_CAP (real $(real_spent)), budget $budget, limit $limit, worst case after $after"
    if [ -n "$STUB" ]; then $STUB "$@" </dev/null || stop "$task stub exited $?"
    else nice -n 10 "$@" </dev/null || stop "$task exited $?"; fi
    TASK_STATE=open
    after_task "$task"
    if [ "$TASK_STATE" = done ]; then touch "$OUT/$task.done"
    else echo "[$(date -u +%H:%M)] $task: a cell not run; no .done, a rerun resumes it"; fi
    return 0
  fi
  # Plan row: the Sonnet per-run mean of the reused cells, scaled by the credit rate.
  reused=$(lite_cells "$task" "$batch"); src=natural
  if [ "$CUR" = list ] && [ -n "$(list_cells "$task")" ]; then reused=$(list_cells "$task"); src=list; fi
  # shellcheck disable=SC2086
  base=$(mean_credits $reused)
  exp=$(awk -v b="$base" -v r="$RATIO" 'BEGIN { if (b == "-") print "-"; else printf "%.2f", b * r }')
  cnt=$(awk -v e="$exp" -v f="$FLOOR" -v n="$REPS" 'BEGIN { if (e == "-") e = f; printf "%.2f", n * (e > f ? e : f) }')
  printf '| %s | %s | %s (%s) | %s | %s | %s | %s | %s | %s |\n' "$task" "$REPS" "$base" "$src" "$exp" "$cnt" "$limit" "$budget" "$s" "$after"
  DRY_REAL=$(awk -v a="$DRY_REAL" -v e="$exp" -v n="$REPS" 'BEGIN { printf "%.2f", a + (e == "-" ? 0 : n * e) }')
  DRY_COUNTED=$(awk -v a="$s" -v c="$cnt" 'BEGIN { printf "%.2f", a + c }')
  DRY_WORST=$(awk -v a="$DRY_WORST" -v b="$budget" -v l="$limit" 'BEGIN { printf "%.2f", a + 0.9 * b + l }')
  DRY_RUNS=$((DRY_RUNS + REPS))
  DRY_LAST="$*"
}

real_spent() {   # the frozen ledger's real credits over the stage's task folders
  node -e 'const {readLedger}=require(process.argv[1]); const fs=require("fs"), p=require("path"); const d=process.argv[2];
    let s=0; for (const t of fs.existsSync(d)?fs.readdirSync(d):[]) if (fs.statSync(p.join(d,t)).isDirectory()) s+=readLedger(p.join(d,t)).totals.total; console.log(s.toFixed(2))' \
    "$R/bench/runner/lib/credit-ledger.js" "$OUT"
}

# Cells of a stage folder for the given tasks: <stage>/<task>/<arm>/<task>/<rep>.
stage_cells() {
  st=$1; arm=$2; shift 2
  for t in "$@"; do for r in 1 2 3; do d=$ROOT/$st/$t/$arm/$t/$r; [ -e "$d/result.json" ] && printf '%s,' "$d"; done; done; return 0
}

summary() {
  all=''; heavy=''; lite8=''; lite4=''; list4=''
  while read -r t b l; do
    all="$all $t"
    for d in $(lite_cells "$t" "$b"); do lite8="$lite8$d,"; done
    case "$HEAVY" in *" $t "*)
      heavy="$heavy $t"
      for d in $(lite_cells "$t" "$b"); do lite4="$lite4$d,"; done
      for d in $(list_cells "$t"); do list4="$list4$d,"; done ;;
    esac
  done <<EOF
$ALL_TASKS
EOF
  mkdir -p "$ROOT"
  # shellcheck disable=SC2086
  node "$(dirname "$0")/model-swap-summary.js" "$CHECK_BENCH" \
    "claude-sonnet-5.5|natural (reused)|8|$lite8" \
    "claude-opus-5.5|natural|8|$(stage_cells natural konductor $all)" \
    "claude-sonnet-5.5|natural (reused)|4|$lite4" \
    "claude-fable-5.1|natural|4|$(stage_cells fable konductor $heavy)" \
    "claude-sonnet-5.5|list (reused)|4|$list4" \
    "claude-opus-5.5|list|4|$(stage_cells list konductor-list $heavy)" > "$ROOT/summary.md"
  cat "$ROOT/summary.md"
}

if [ "$MODE" = --summary ]; then summary; exit 0; fi

check_setup
if [ "$MODE" = --go ] && [ -z "$STUB" ]; then
  unshare -Urm true 2>/dev/null || stop "user namespaces are blocked in this shell (--isolate unshare needs them): run from your own terminal"
fi

plan_stage() {
  stage_conf "$1"
  [ "$1" = list ] && check_list_arm
  RATIO=$(rate_ratio "$MODEL")
  DRY_COUNTED=$(counted_spent "$OUT"); DRY_REAL=0; DRY_WORST=0; DRY_RUNS=0; DRY_LAST=''
  echo; echo "## stage $1: $ARM_ID on $MODEL (credit rate $RATIO x Sonnet 5.5), $REPS replicates, cap $STAGE_CAP"
  echo; echo '| task | runs | Sonnet credits a run (reused) | expected a run | counted | run limit | budget | counted before | worst case after |'
  echo '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  while read -r t b l; do if in_stage "$t"; then run_task "$t" "$b" "$l"; fi; done <<EOF
$ALL_TASKS
EOF
  echo; echo "stage $1: $DRY_RUNS runs, expected real $DRY_REAL, counted $(awk -v a="$DRY_COUNTED" 'BEGIN { printf "%.0f", a }'), worst case $(awk -v w="$DRY_WORST" -v c="$STAGE_CAP" 'BEGIN { printf "%.2f", (w < c ? w : c) }') (the cap guard keeps it under $STAGE_CAP)"
  echo "last command: $DRY_LAST"
}

wait_others
if [ "$MODE" = --plan ]; then
  n=0
  while read -r t b l; do n=$((n + $(lite_cells "$t" "$b" | wc -l))); done <<EOF
$ALL_TASKS
EOF
  echo "reused Sonnet 5.5 cells: $n (LITE konductor arm, $LITE)"
  for st in ${STAGE:-natural list fable}; do plan_stage "$st"; done
  exit 0
fi

stage_conf "$STAGE"
[ "$STAGE" = list ] && check_list_arm
RATIO=$(rate_ratio "$MODEL")
mkdir -p "$OUT"
exec 9>"$ROOT/.lock"
flock -n 9 || stop "another run-model-swap.sh stage holds $ROOT/.lock"
# Not a pipe: the loop must run in this shell.
while read -r t b l; do if in_stage "$t"; then run_task "$t" "$b" "$l"; fi; done <<EOF
$ALL_TASKS
EOF
echo "[$(date -u +%H:%M)] stage $STAGE done, counted $(counted_spent "$OUT") of $STAGE_CAP (real $(real_spent))"
