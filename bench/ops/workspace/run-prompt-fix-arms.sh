#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# run-prompt-fix-arms.sh: the konductor prompt-fix study (reports/konductor-prompt-fixes-2026-11-27.md Part C), three
# arms: vanilla, konductor-adaptive (cap variant of konductor c042c7ba with fixes 1 to 9, bench/ops/prompt-fixes) and
# konductor-coordinator (konductor c042c7ba with --arm-config orchestration.mode=coordinator). Owner terminal only for
# the paid steps: they spend Kiro credits or USD and need the sandbox (unshare).
#
#   bash run-prompt-fix-arms.sh --plan                 free: builds and verifies the adaptive arm and batch C's git copy
#                                                      of CardDemo, prints the runs, the credit forecast of every step
#                                                      against its cap, the judge cost and whether the read view can run
#   bash run-prompt-fix-arms.sh smoke|A|B|C            a paid step in the background (log $S/<step>.log)
#   bash run-prompt-fix-arms.sh judge                  the paid judge pass (USD) over every finished run, then the report
#   bash run-prompt-fix-arms.sh <step> --foreground    the same, in this terminal
#   bash run-prompt-fix-arms.sh sign-carddemo-key [--yes]   free: shows CardDemo's Pattern key; --yes records the
#                                                      owner's sign-off, which batch C needs
#   bash run-prompt-fix-arms.sh rebook [--yes]         free: moves the bench pin to BENCH_REF when it carries the D-297
#                                                      meter fix, and un-books runs the old v3 estimate stopped under
#                                                      their limit (booked at measured spend, run again); --yes applies
#   bash run-prompt-fix-arms.sh reply-check --plan     free: builds and verifies the candidate arm (the frozen adaptive
#                                                      arm's fixes 1 to 9 plus P1 and P2) and prints the reply check's
#                                                      calls and caps
#   REVIEWER=claude-opus-5.5 bash run-prompt-fix-arms.sh reply-check   PAID (background, log $S/reply-check.log): the
#                                                      reply check of reports/adaptive-prompt-cap-check-2026-11-27.md
#
# reply-check: 4 smoke tasks x 3 reps of the candidate arm, stopped early (--max-tool-calls 8, --run-credit-limit 6;
# runs cap 72), then one frozen reviewer prompt per run plus the 3 finished smoke runs of t1-bug-date-range,
# t12-mux-parallel-merge and t12-split-shared-file (15 prompts), each read by the Claude reviewer (REVIEWER:
# claude-opus-5.5, the default, or claude-fable-5.1; counted at max(15, real) a call) and by the panel gpt-5.6-luna,
# deepseek-3.2, qwen3-coder-next on opencode (USD). Caps (owner, 2026-11-27): 300 credits for the runs and the Claude
# reviewer together, USD 0.50 for the panel; each run and each call is checked against its ledger before it starts.
# The panel majority is the verdict ($S/reply-check/report.md, both reviewers side by side, every disagreement flagged).
# It reads the study's smoke runs and nothing else of the study: its own folder $S/reply-check (plan.json there pins
# its own bench checkout RC_REPO [$KONDUCTOR_WS/worktrees/reply-check]), never $S/plan.json, R or the frozen arm.
#
# Steps (bench/ops/prompt-fixes/study.js STEPS): smoke 4 tasks x 3 arms x 1 rep, cap 90 credits, 25 a run; A rows 1-9
# x 3 arms x 3 reps, cap 800; B rows 10-14 x 3 arms x 3 reps, cap 700; per-run limit 100 in A and B; C cx-carddemo-
# batchday x 3 arms, 3 reps when they fit 598 (the owner's cap, 2026-11-27, D-298; it was 520, then 474) else 2, soft per-run cap 270
# (as run-cx.sh --soft: never kills a run; 270 is the 3600 s timeout at 4.5 credits a minute). Each run is its own
# bench.js call. Before each one the credit ledger of the step must have no entry of unknown cost, spend plus the
# per-run limit must stay within the cap, and at 60% of the cap the forecast of the runs left must fit (study.js
# may-start). A, B and C start only after the smoke gate passed: every adaptive run wrote a Plan line that parses, and
# the adaptive run of t12-mux-parallel-merge ran 2 or more writer spawns. C also needs the owner's sign-off of
# CardDemo's Pattern key, recorded for the answer key's current bytes. C runs from a git-initialised copy of the task
# ($S/tasks-c, study carddemo-git.js): the hidden tests and goldens are copied byte for byte and checked.
# judge: for each finished run, the rubric pass in the read view (opencode, compaction off, isolation required: it
# stops, never falls back to the bundle view) and the quality criteria pack (bundle view: the read view serves rubric
# only), panel gpt-5.6-luna, deepseek-3.2, qwen3-coder-next. Cap JUDGE_CAP_USD (default: the forecast's high estimate,
# rounded up); before each run's pass, judge spend plus that run's high estimate must stay within it.
# The first paid start freezes the plan in $S/plan.json (bench sha, adaptive arm and tree hash, expect.json hash); later
# steps check the bench worktree R is still at that sha and clean. Rerun a step to resume: finished runs are skipped.
# ADAPTIVE_WITH=p1p2 builds the adaptive arm with P1 and P2 too: only for a new study (a new S and R), since a frozen
# plan keeps its own arm.
# Needs (defaults in brackets): S [/var/tmp/konductor-prompt-fix], R [$KONDUCTOR_WS/worktrees/prompt-fix, made from the
# ops checkout on the first --plan], KBIN [the pinned kiro-cli 3.5.0], PY312 [mise Python 3.12], CACHE [$S/cache],
# AWS_PROFILE_NAME [default] for the judge.
# Test overrides: BENCH_JS, ADAPTIVE_ARM, CANDIDATE_ARM, REVIEW_KIRO_BIN, REVIEW_AUTH_DB, PANEL_MODULE, HOST_CHECK=0 (no host, binary, login, credential or namespace check),
# GIT_CHECK=0 (no worktree or pin check), NO_FETCH=1, WAIT_MAX, WAIT_STEP, HEAVY_LOCK, LITE_LOCK, OWN_LOCK.
set -u

WS=${KONDUCTOR_WS:-}
S=${S:-/var/tmp/konductor-prompt-fix}
R=${R:-$WS/worktrees/prompt-fix}
OPS=${KONDUCTOR_OPS:-$WS/worktrees/ops}
KBIN=${KBIN:-/var/tmp/k2x2/bin/kiro-cli-3.5.0/kiro-cli}
KBIN_PIN=${KBIN_PIN:-e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e}
PY312=${PY312:-}
CACHE=${CACHE:-$S/cache}
BENCH_REF=${BENCH_REF:-origin/feat/bench-pilot-nk}
BENCH_JS=${BENCH_JS:-}
ADAPTIVE_ARM=${ADAPTIVE_ARM:-}
PROFILE=${AWS_PROFILE_NAME:-default}
JUDGE_CAP_USD=${JUDGE_CAP_USD:-}
HOST_CHECK=${HOST_CHECK:-1}; GIT_CHECK=${GIT_CHECK:-1}; NO_FETCH=${NO_FETCH:-0}
HEAVY_LOCK=${HEAVY_LOCK:-/var/tmp/konductor-heavy.lock}
LITE_LOCK=${LITE_LOCK:-/var/tmp/konductor-lite.lock}
OWN_LOCK=${OWN_LOCK:-/var/tmp/konductor-prompt-fix.lock}
WAIT_MAX=${WAIT_MAX:-3600}; WAIT_STEP=${WAIT_STEP:-60}
KSHA=c042c7ba7520a3332f1151e3f9733f7033557e65
SEED=20261127
PLAN=$S/plan.json
TASKS_C=$S/tasks-c
SIGNOFF=$S/carddemo-key.signoff
CX_KEY_REL=bench/complex/fixtures/cx-carddemo-batchday/.bench-answer-key.md
STUDY=""; ARM_ADAPTIVE=""; ARM_HASH=""
CANDIDATE_ARM=${CANDIDATE_ARM:-}
ADAPTIVE_WITH=${ADAPTIVE_WITH:-}
RC_S=$S/reply-check
RC_REPO=${RC_REPO:-$WS/worktrees/reply-check}
REVIEWER=${REVIEWER:-claude-opus-5.5}
RC_NAME=konductor-adaptive-p12
RC_CAP=300 RC_RUN_CAP=72 RC_RUN_LIMIT=6 RC_TOOLS=8 RC_REPS=3 RC_USD=0.50
RC_SMOKE_PROMPTS=t1-bug-date-range,t12-mux-parallel-merge,t12-split-shared-file
ARM_RC=""; RC_HASH=""; RCJS=""

. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"
usage() { echo "usage: bash $0 --plan | smoke|A|B|C|judge [--foreground] | sign-carddemo-key [--yes] | rebook [--yes] | reply-check [--plan|--foreground]"; exit 64; }

# under_home PATH: true when PATH (resolved through its nearest existing parent) is under HOME.
under_home() {
  local real home
  home=$(realpath -m -- "$HOME"); real=$(realpath -m -- "$1")
  case "$real/" in "$home"/*) return 0 ;; esac
  return 1
}

# busy: prints why the host is not quiet, or returns 1. HOST_CHECK=0 keeps only the lock checks.
busy() {
  flock -n "$HEAVY_LOCK" true 2>/dev/null || { echo "the heavy lock $HEAVY_LOCK is held"; return 0; }
  flock -n "$LITE_LOCK" true 2>/dev/null || { echo "a LITE run holds $LITE_LOCK"; return 0; }
  [ "$HOST_CHECK" = 0 ] && return 1
  pgrep -f 'run-pilot|run-forced|pilot-wave[.]sh|run-standard[.]sh|run-cx[.]sh' >/dev/null && { echo "a pilot, forced-small, STANDARD or CardDemo script is running"; return 0; }
  pgrep -f 'bench/runner/bench[.]js run' >/dev/null && { echo "another bench.js run is running"; return 0; }
  awk -v l="$(cut -d' ' -f1 /proc/loadavg)" 'BEGIN { exit !(l >= 4) }' && { echo "load $(cut -d' ' -f1 /proc/loadavg) is 4 or more"; return 0; }
  return 1
}
wait_quiet() {
  local waited=0 why
  while why=$(busy); do
    [ "$waited" -ge "$WAIT_MAX" ] && stop "$why for ${waited}s; rerun this command later (it resumes)"
    say "waiting: $why (waited ${waited}s)"; sleep "$WAIT_STEP"; waited=$((waited + WAIT_STEP))
  done
}

# namespaces: true when this shell may make user namespaces (--isolate unshare and the read view need them).
namespaces() { [ "$HOST_CHECK" = 0 ] || unshare -Urm true 2>/dev/null; }

# tools: the pinned kiro-cli, Python 3.12 and the login (HOST_CHECK=0 skips all three).
tools() {
  local paid=$1
  [ "$HOST_CHECK" = 0 ] && return 0
  [ -n "$PY312" ] || PY312=$(ls -d "$HOME"/.local/share/mise/installs/python/3.12.*/bin/python3.12 2>/dev/null | sort -V | tail -1)
  [ -x "$PY312" ] || stop "no Python 3.12: set PY312"
  [ -x "$KBIN" ] || stop "no kiro-cli at $KBIN"
  [ "$(sha256sum "$KBIN" | cut -d' ' -f1)" = "$KBIN_PIN" ] || stop "$KBIN is not the pinned kiro-cli 3.5.0"
  if "$KBIN" whoami >/dev/null 2>&1; then say "kiro login: ok"
  elif [ "$paid" = 1 ]; then stop "Kiro login expired or missing: run '$KBIN login', then this script again"
  else say "kiro login: NOT signed in (a paid step would stop: $KBIN login)"; fi
  [ "$paid" = 0 ] || namespaces || stop "user namespaces are blocked in this shell (--isolate unshare needs them)"
}

# worktree PIN [REPO]: REPO (default R) exists (made from the ops checkout when missing), is clean, and sits at PIN (or
# BENCH_REF when PIN is empty).
worktree() {
  local pin=$1 repo=${2:-$R}
  [ "$GIT_CHECK" = 0 ] && return 0
  if [ ! -e "$repo/.git" ]; then
    git -C "$OPS" fetch -q origin feat/bench-pilot-nk || stop "fetch failed in $OPS"
    git -C "$OPS" worktree add -q --detach "$repo" "$BENCH_REF" || stop "cannot add the bench worktree $repo"
    say "bench worktree added: $repo"
  fi
  [ -z "$(git -C "$repo" status --porcelain)" ] || stop "$repo has local changes: use a clean worktree"
  if [ -z "$pin" ]; then
    [ "$NO_FETCH" = 1 ] || git -C "$repo" fetch -q origin feat/bench-pilot-nk main || stop "fetch failed in $repo"
    git -C "$repo" checkout -q --detach "$BENCH_REF" || stop "checkout of $BENCH_REF failed in $repo"
  elif [ "$(git -C "$repo" rev-parse HEAD)" != "$pin" ]; then
    stop "$repo is at $(git -C "$repo" rev-parse --short HEAD), not the frozen bench pin ${pin:0:8}; this study does not move it. Check it out again with git -C $repo checkout --detach $pin"
  fi
}

# build_arm REPO DIR NAME [WITH]: builds the candidate files from REPO's edits (WITH: an extra edit set of
# build-candidates.js) and their cap variant under DIR (with --verify, free); sets BUILT_ARM (NAME=dir:...) and BUILT_HASH.
build_arm() {
  local repo=$1 dir=$2 name=$3 with=${4:-} out json vargs
  local -a extra=()
  [ -n "$with" ] && extra=(--with "$with")
  mkdir -p "$dir/candidates" "$dir/variants"
  json=$(node "$repo/bench/ops/prompt-fixes/build-candidates.js" --repo "$repo" --out "$dir/candidates" --json "${extra[@]}") || stop "the candidate edits did not apply to $KSHA"
  mapfile -t vargs < <(printf '%s' "$json" | node -e 'for (const a of JSON.parse(require("fs").readFileSync(0, "utf8")).variantArgs) console.log(a)')
  out=$(nice -n 10 node "$repo/bench/runner/bench.js" cap variant --scratch "$dir/variants" --base "$KSHA" "${vargs[@]}" \
    --agent-engine v3 --cache "$CACHE" --repo-root "$repo" --json --verify 2> "$dir/variants/variant.log") \
    || stop "cap variant or its verify failed; see $dir/variants/variant.log"
  read -r BUILT_ARM BUILT_HASH < <(printf '%s' "$out" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); if (!j.verify || !j.verify.ok) process.exit(1); console.log(process.argv[1] + "=dir:" + j.dir, j.meta.variantHash)' "$name") \
    || stop "verifyInstalled failed; see $dir/variants/variant.log"
  under_home "${BUILT_ARM#*=dir:}" && stop "the arm $name is under HOME"
  return 0
}

# adaptive_arm: the study's konductor-adaptive arm (fixes 1 to 9, plus the edit set ADAPTIVE_WITH names, for example
# p1p2 for a new study after the reply check); sets ARM_ADAPTIVE and ARM_HASH.
adaptive_arm() {
  if [ -n "$ADAPTIVE_ARM" ]; then ARM_ADAPTIVE=$ADAPTIVE_ARM; ARM_HASH=test; return 0; fi
  build_arm "$R" "$S" konductor-adaptive "$ADAPTIVE_WITH"
  ARM_ADAPTIVE=$BUILT_ARM; ARM_HASH=$BUILT_HASH
  say "adaptive arm: $ARM_ADAPTIVE (variantHash ${ARM_HASH:0:12}, verifyInstalled ok)"
}

# tasks_c: batch C's task copy with a git fixture (built once); stops when its hidden tests differ from R's.
tasks_c() {
  local want got
  if [ ! -s "$TASKS_C/manifest.json" ]; then
    node "$R/bench/ops/prompt-fixes/carddemo-git.js" --bench "$R/bench" --out "$TASKS_C" > "$S/tasks-c.log" 2>&1 || stop "cannot build $TASKS_C (see $S/tasks-c.log)"
  fi
  want=$(node -e "console.log(require('$R/bench/ops/prompt-fixes/carddemo-git.js').treeHash('$R/bench/complex/hidden/cx-carddemo-batchday'))")
  got=$(node -p "require('$TASKS_C/manifest.json').hashes.hidden")
  [ "$want" = "$got" ] || stop "$TASKS_C holds other hidden tests than $R; move it away and rerun"
  say "batch C task copy: $TASKS_C (fixture commit $(node -p "require('$TASKS_C/manifest.json').commit.slice(0, 12)"), hidden tests and goldens byte for byte)"
}

key_sha() { sha256sum "$R/$CX_KEY_REL" | cut -d' ' -f1; }
# signed: true when the sign-off file records the answer key's current bytes.
signed() { [ -s "$SIGNOFF" ] && [ "$(cut -d' ' -f1 "$SIGNOFF")" = "$(key_sha)" ]; }

sign_mode() {
  local yes=$1
  worktree ""
  awk '/^## Pattern key/{f=1; print; next} /^## /{f=0} f' "$R/$CX_KEY_REL"
  if [ "$yes" = 1 ]; then
    printf '%s %s %s\n' "$(key_sha)" "$(date -u +%Y-%m-%dT%H:%MZ)" "${USER:-owner}" > "$SIGNOFF"
    say "sign-off recorded: $SIGNOFF (answer key sha256 $(key_sha | cut -c1-12)); batch C may start"
  else
    say "read the Pattern key above; to sign it off: bash $0 sign-carddemo-key --yes"
  fi
}

plan_mode() {
  local f
  worktree ""
  tools 0
  STUDY=$R/bench/ops/prompt-fixes/study.js
  adaptive_arm
  tasks_c
  f=$(node "$STUDY" forecast) || stop "forecast failed"
  say "arms: vanilla, $ARM_ADAPTIVE, konductor-coordinator=$KSHA (--arm-config orchestration.mode=coordinator)"
  printf '%s' "$f" | node -e '
    const f = JSON.parse(require("fs").readFileSync(0, "utf8"));
    console.log("step   runs  vanilla  adaptive  coordinator  forecast  cap  per-run  worst case  fits  judge USD (mid/high)");
    for (const [k, v] of Object.entries(f.steps)) console.log([k.padEnd(5), String(v.runs).padStart(5), String(v.arms.vanilla).padStart(8), String(v.arms["konductor-adaptive"]).padStart(9), String(v.arms["konductor-coordinator"]).padStart(12), String(v.total).padStart(9), String(v.cap).padStart(4), (v.runLimit + (v.soft ? "s" : "")).padStart(8), String(v.worstCase).padStart(11), v.fits ? "  yes" : "   NO", `  ${v.judgeUsd.mid}/${v.judgeUsd.high}`].join(" "));
    const c = f.steps.C;
    console.log(`batch C: ${c.reps} reps (3 arms x 3 reps would forecast ${Math.round(c.total / c.reps * 3 * 10) / 10}, over the cap ${c.cap}); per-run cap ${c.runLimit} soft; the per-run check lets ${c.startable} of ${c.runs} runs start at the forecast costs`);
    console.log(`judge: ${f.judge.panel.join(", ")}; rubric in the read view, quality pack in the bundle view; forecast USD ${f.judge.mid} (high ${f.judge.high}); cap USD ${process.env.JUDGE_CAP_USD || f.judge.capUsd}`);
    console.log("forecast: measured STANDARD v2 means for vanilla and konductor, times the inferred ratios in study.js; worst case is runs x per-run limit, which the cap stops long before");'
  if namespaces; then say "read view: can run here (user namespaces available)"
  else say "read view: CANNOT run in this shell (no user namespaces): the judge step will stop for every run; it does not fall back to the bundle view"; fi
  if signed; then say "CardDemo Pattern key: signed off ($SIGNOFF)"
  else say "CardDemo Pattern key: NOT signed off; batch C refuses until: bash $0 sign-carddemo-key --yes"; fi
  [ -s "$PLAN" ] && say "a frozen plan exists ($PLAN): the paid steps keep using it"
  say "plan only: nothing was run or spent. Paid: bash $0 smoke"
}

# freeze: the first paid start writes $PLAN; later starts check the adaptive arm against it.
freeze() {
  local sha expect
  STUDY=$R/bench/ops/prompt-fixes/study.js
  expect=$(sha256sum "$R/bench/scenarios/konductor/prompt-fix/expect.json" | cut -d' ' -f1)
  if [ -s "$PLAN" ]; then
    sha=$(node -p "require('$PLAN').benchSha")
    worktree "$sha"
    ARM_ADAPTIVE=$(node -p "require('$PLAN').adaptiveArm"); ARM_HASH=$(node -p "require('$PLAN').adaptiveHash")
    [ "$(node -p "require('$PLAN').expectSha256")" = "$expect" ] || stop "expect.json changed since the plan was frozen"
    [ -d "${ARM_ADAPTIVE#konductor-adaptive=dir:}" ] || stop "the frozen adaptive arm tree is gone: ${ARM_ADAPTIVE#konductor-adaptive=dir:}"
    say "frozen plan: bench ${sha:0:8}, adaptive ${ARM_HASH:0:12}"
    return 0
  fi
  worktree ""
  adaptive_arm
  sha=$( [ "$GIT_CHECK" = 0 ] && echo test || git -C "$R" rev-parse HEAD )
  mkdir -p "$S"
  node -e 'const [f, b, a, h, e, k] = process.argv.slice(1); require("fs").writeFileSync(f, JSON.stringify({ created: new Date().toISOString(), benchSha: b, konductorSha: k, adaptiveArm: a, adaptiveHash: h, expectSha256: e }, null, 2) + "\n");' \
    "$PLAN" "$sha" "$ARM_ADAPTIVE" "$ARM_HASH" "$expect" "$KSHA"
  say "plan frozen: $PLAN"
}

# run_cell STEP TASK ARM REP: one paid run, after the cap and stop-rule check.
run_cell() {
  local step=$1 task=$2 arm=$3 rep=$4 U why left limit rc=0 here unknown
  local -a A=()
  U=$S/runs/$step/$task/$arm/r$rep
  [ -e "$U.done" ] && return 0
  why=$(node "$STUDY" may-start "$S/runs/$step" "$step") || stop "$why"
  wait_quiet
  [ "$HOST_CHECK" = 0 ] || "$KBIN" whoami >/dev/null 2>&1 || stop "Kiro login expired: run '$KBIN login', then this script again (it resumes)"
  [ "$GIT_CHECK" = 0 ] || [ "$(git -C "$R" rev-parse HEAD)" = "$(node -p "require('$PLAN').benchSha")" ] || stop "$R moved off the frozen bench pin during the step"
  read -r here unknown < <(node "$STUDY" spent "$S/runs/$step")
  limit=$(node -p "require('$STUDY').STEPS['$step'].runLimit")
  left=$(node -p "require('$STUDY').STEPS['$step'].cap - $here")
  case "$arm" in
    vanilla) A=(--arms vanilla) ;;
    konductor-adaptive) A=(--arms "$ARM_ADAPTIVE") ;;
    konductor-coordinator) A=(--arms "konductor-coordinator=$KSHA" --arm-config konductor-coordinator=orchestration.mode=coordinator) ;;
    *) stop "unknown arm $arm" ;;
  esac
  if [ "$step" = C ]; then
    A+=(--suite complex --suites-dir "$TASKS_C/suites" --timeout-sec 3600 --run-credit-limit-mode soft)
  else
    A+=(--suite pack)
  fi
  A+=(--tasks "$task" --replicates 1 --replicate-offset $((rep - 1)) --parallel 1 --repo-root "$R" --hide "$R"
    --isolate unshare --seed "$SEED" --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN"
    --cache "$CACHE" --budget-credits "$left" --run-credit-limit "$limit" --out "$U")
  [ -n "$PY312" ] && A+=(--python "$PY312")
  if [ -f "$U/run-config.json" ]; then A+=(--resume)
  elif [ -e "$U" ]; then mkdir -p "$S/incomplete" && mv -- "$U" "$S/incomplete/$step-$task-$arm-r$rep.$(date +%s)"; fi
  mkdir -p "$(dirname "$U")"
  say "$step $task $arm r$rep: start (step spent $here of $(node -p "require('$STUDY').STEPS['$step'].cap"), run limit $limit)"
  nice -n 10 node "${BENCH_JS:-$R/bench/runner/bench.js}" run "${A[@]}" >> "$U.log" 2>&1 || rc=$?
  say "$step $task $arm r$rep: exit $rc, step spent $(node "$STUDY" spent "$S/runs/$step" | cut -d' ' -f1)"
  case "$rc" in
    0) touch "$U.done" ;;
    3) stop "bench credit guard stopped $step $task $arm r$rep (exit 3)" ;;
    6) stop "login failures (exit 6): run '$KBIN login', then this script again" ;;
    *) stop "bench exit $rc on $step $task $arm r$rep (see $U.log); rerun to resume" ;;
  esac
}

paid_mode() {
  local step=$1 task arm rep g
  tools 1
  exec 9> "$OWN_LOCK"
  flock -n 9 || stop "another prompt-fix step holds $OWN_LOCK"
  if [ "$step" != smoke ]; then
    grep -qx PASS "$S/smoke.gate" 2>/dev/null || stop "the smoke gate has not passed ($(head -1 "$S/smoke.gate" 2>/dev/null || echo 'no smoke run yet')): run smoke first"
  fi
  freeze
  if [ "$step" = C ]; then
    signed || stop "CardDemo's Pattern key ($CX_KEY_REL) is not signed off for its current bytes: read it with bash $0 sign-carddemo-key, then sign with --yes"
    tasks_c
  fi
  mkdir -p "$S/runs/$step"
  while read -r task arm rep; do run_cell "$step" "$task" "$arm" "$rep"; done < <(node "$STUDY" cells "$step")
  if [ "$step" = smoke ]; then
    g=$(node "$STUDY" gate "$S/runs/smoke")
    printf '%s\n' "$g" > "$S/smoke.gate"
    say "smoke gate: $g"
    [ "$g" = PASS ] || stop "the smoke gate failed; batches A, B and C will not start"
  fi
  say "step $step done: $(node "$STUDY" spent "$S/runs/$step" | cut -d' ' -f1) credits of $(node -p "require('$STUDY').STEPS['$step'].cap")"
}

# judge_cell U TASK PASS: one judge pass over one run dir (rubric: read view; quality: the pack, bundle view).
judge_cell() {
  local U=$1 task=$2 pass=$3 why left extra rc=0
  local -a A=()
  [ -e "$U.judged-$pass" ] && return 0
  why=$(node "$STUDY" judge-may-start "$S/runs" "$task" "$JUDGE_CAP_USD") || stop "$why"
  left=$(node -p "Math.round(($JUDGE_CAP_USD - $(node "$STUDY" usd-spent "$S/runs")) * 10000) / 10000")
  extra=$(node -p "require('$R/bench/suites/pack.json').extraTasks.map((d) => '$R/bench/' + d).join(',')")
  [ "$task" = cx-carddemo-batchday ] && extra=$TASKS_C/tasks
  A=(judge --run "$U" --judges gpt-5.6-luna,deepseek-3.2,qwen3-coder-next --judge-backend opencode --aws-export-profile "$PROFILE"
    --extra-tasks "$extra" --budget-usd "$left" --concurrency 1)
  if [ "$pass" = rubric ]; then A+=(--mode rubric --judge-view read --isolate unshare --hide "$R"); else A+=(--criteria-pack quality); fi
  say "judge $pass: $U (judge spent USD $(node "$STUDY" usd-spent "$S/runs") of $JUDGE_CAP_USD)"
  nice -n 10 node "${BENCH_JS:-$R/bench/runner/bench.js}" "${A[@]}" >> "$U.judge-$pass.log" 2>&1 || rc=$?
  [ "$rc" = 0 ] || stop "judge $pass exit $rc on $U (see $U.judge-$pass.log); rerun to resume"
  touch "$U.judged-$pass"
}

judge_mode() {
  local U task pass runs extra
  local -a dirs=()
  tools 0
  namespaces || stop "the read view needs user namespaces (--isolate unshare) and this shell has none; the judge pass does not fall back to the bundle view"
  [ "$HOST_CHECK" = 0 ] || aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1 || stop "AWS credentials for profile $PROFILE are missing or expired; refresh them and rerun"
  exec 9> "$OWN_LOCK"
  flock -n 9 || stop "another prompt-fix step holds $OWN_LOCK"
  freeze
  [ -n "$JUDGE_CAP_USD" ] || JUDGE_CAP_USD=$(node "$STUDY" forecast | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).judge.capUsd)')
  mapfile -t dirs < <(find "$S/runs" -name '*.done' -path '*/r*.done' 2>/dev/null | sed 's/\.done$//' | sort)
  [ "${#dirs[@]}" -gt 0 ] || stop "no finished run under $S/runs to judge"
  for pass in rubric quality; do
    for U in "${dirs[@]}"; do
      task=$(basename "$(dirname "$(dirname "$U")")")
      judge_cell "$U" "$task" "$pass"
    done
  done
  say "judged ${#dirs[@]} runs: USD $(node "$STUDY" usd-spent "$S/runs") of $JUDGE_CAP_USD"
  runs=$(printf '%s\n' "${dirs[@]}" | paste -sd, -)
  extra=$(node -p "require('$R/bench/suites/pack.json').extraTasks.map((d) => '$R/bench/' + d).join(',')")
  [ -d "$TASKS_C/tasks" ] && extra=$extra,$TASKS_C/tasks
  node "${BENCH_JS:-$R/bench/runner/bench.js}" report --run "$runs" --baseline vanilla --extra-tasks "$extra" --criteria-pack quality \
    --out "$S/report" > "$S/report.log" 2>&1 || stop "report failed (see $S/report.log)"
  say "report: $S/report/report.md"
}

# rebook_mode YES: free. Moves the frozen bench pin to BENCH_REF (it must carry the D-297 meter fix and be ahead of the
# pin; plan.json keeps the old pin under repins), then un-books every estimate-fault stop of every step (study.js rebook):
# the cell moves to $S/incomplete and is booked at its measured spend, so the next step run runs it again. Without
# --yes it only says what it would do.
rebook_mode() {
  local yes=$1 old new st tool
  exec 9> "$OWN_LOCK"
  flock -n 9 || stop "a prompt-fix step holds $OWN_LOCK: wait for it to end"
  [ -s "$PLAN" ] || stop "no frozen plan in $PLAN: nothing to re-book"
  old=$(node -p "require('$PLAN').benchSha")
  new=$old
  if [ "$GIT_CHECK" != 0 ]; then
    [ -z "$(git -C "$R" status --porcelain)" ] || stop "$R has local changes: use a clean worktree"
    [ "$NO_FETCH" = 1 ] || git -C "$R" fetch -q origin feat/bench-pilot-nk || stop "fetch failed in $R"
    new=$(git -C "$R" rev-parse "$BENCH_REF") || stop "cannot resolve $BENCH_REF in $R"
    git -C "$R" merge-base --is-ancestor "$old" "$new" || stop "$BENCH_REF (${new:0:8}) is not ahead of the frozen pin ${old:0:8}"
    git -C "$R" grep -q 'D-297' "$new" -- bench/runner/lib/credit-watch.js || stop "$BENCH_REF (${new:0:8}) has no D-297 meter fix"
  fi
  tool=$OPS/bench/ops/prompt-fixes/study.js
  [ -f "$tool" ] || tool=$STUDY
  for st in smoke A B C; do
    [ -d "$S/runs/$st" ] || continue
    say "$st: booked $(node "$tool" spent "$S/runs/$st" | cut -d' ' -f1) of $(node -p "require('$tool').STEPS['$st'].cap")"
    node "$tool" rebook "$S/runs/$st" "$S/incomplete" | sed "s/^/  /"
  done
  if [ "$yes" != 1 ]; then
    say "dry run: nothing moved. bench pin ${old:0:8} -> ${new:0:8}. Apply: bash $0 rebook --yes"
    return 0
  fi
  if [ "$new" != "$old" ]; then
    git -C "$R" checkout -q --detach "$new" || stop "checkout of ${new:0:8} failed in $R"
    node -e 'const [f, o, n] = process.argv.slice(1); const p = JSON.parse(require("fs").readFileSync(f, "utf8")); p.repins = [...(p.repins || []), { from: o, to: n, at: new Date().toISOString(), reason: "D-297: the v3 per-run limit meters the session creditSplit" }]; p.benchSha = n; require("fs").writeFileSync(f, JSON.stringify(p, null, 2) + "\n");' "$PLAN" "$old" "$new"
    say "bench pin moved: ${old:0:8} -> ${new:0:8} (plan.json repins)"
  fi
  for st in smoke A B C; do
    [ -d "$S/runs/$st" ] || continue
    node "$STUDY" rebook "$S/runs/$st" "$S/incomplete" --apply | sed "s/^/  /"
    say "$st: booked $(node "$STUDY" spent "$S/runs/$st" | cut -d' ' -f1) of $(node -p "require('$STUDY').STEPS['$st'].cap") after the re-book"
  done
}

# rc_arm: the reply check's candidate arm (fixes 1 to 9, then P1 and P2) from RC_REPO; sets ARM_RC and RC_HASH.
rc_arm() {
  if [ -n "$CANDIDATE_ARM" ]; then ARM_RC=$CANDIDATE_ARM; RC_HASH=test; return 0; fi
  build_arm "$RC_REPO" "$RC_S" "$RC_NAME" p1p2
  ARM_RC=$BUILT_ARM; RC_HASH=$BUILT_HASH
  say "candidate arm: $ARM_RC (variantHash ${RC_HASH:0:12}, verifyInstalled ok)"
}

rc_reviewer() {
  case "$REVIEWER" in claude-opus-5.5|claude-fable-5.1) ;; *) stop "REVIEWER must be claude-opus-5.5 or claude-fable-5.1 (the owner's choice), not $REVIEWER" ;; esac
}

# rc_freeze: the first paid start writes $RC_S/plan.json (its bench pin, the candidate arm, the reviewer); later starts
# check RC_REPO is still there and the reviewer is the same, so every prompt is read by one Claude model.
rc_freeze() {
  local f=$RC_S/plan.json sha
  if [ -s "$f" ]; then
    worktree "$(node -p "require('$f').benchSha")" "$RC_REPO"
    ARM_RC=$(node -p "require('$f').arm"); RC_HASH=$(node -p "require('$f').armHash")
    [ "$(node -p "require('$f').reviewer")" = "$REVIEWER" ] || stop "the reply check was frozen with REVIEWER=$(node -p "require('$f').reviewer"); rerun with that"
    [ -d "${ARM_RC#*=dir:}" ] || stop "the frozen candidate arm tree is gone: ${ARM_RC#*=dir:}"
    say "reply check plan: bench $(node -p "require('$f').benchSha.slice(0, 8)"), candidate ${RC_HASH:0:12}, reviewer $REVIEWER"
    return 0
  fi
  worktree "" "$RC_REPO"
  rc_arm
  sha=$( [ "$GIT_CHECK" = 0 ] && echo test || git -C "$RC_REPO" rev-parse HEAD )
  mkdir -p "$RC_S"
  node -e 'const [f, b, a, h, r] = process.argv.slice(1); require("fs").writeFileSync(f, JSON.stringify({ created: new Date().toISOString(), benchSha: b, arm: a, armHash: h, reviewer: r, capCredits: 300, runCap: 72, capUsd: 0.5 }, null, 2) + "\n");' \
    "$f" "$sha" "$ARM_RC" "$RC_HASH" "$REVIEWER"
  say "reply check plan frozen: $f"
}

rc_plan_mode() {
  local rcjs smoke n
  rc_reviewer
  worktree "" "$RC_REPO"
  tools 0
  rc_arm
  rcjs=$RC_REPO/bench/ops/prompt-fixes/reply-check.js
  n=0
  [ -d "$S/runs/smoke" ] && n=$(( $(node "$rcjs" score --runs "$S/runs/smoke" | wc -l) - 2 ))
  smoke=$(node "$rcjs" plan --tasks smoke --reps "$RC_REPS" --run-limit "$RC_RUN_LIMIT" --prompt-kchars 10) || stop "reply-check.js plan failed"
  printf '%s' "$smoke" | RC_CAP=$RC_CAP RC_USD=$RC_USD RC_RUN_CAP=$RC_RUN_CAP REVIEWER=$REVIEWER node -e '
    const p = JSON.parse(require("fs").readFileSync(0, "utf8")); const e = process.env;
    const outputs = p.runs + 3;
    console.log(`runs: ${p.runs} early-stopped runs of the candidate arm (4 smoke tasks x 3 reps, 8 tool calls, 6 credits each): up to ${p.runCredits} credits (run cap ${e.RC_RUN_CAP})`);
    console.log(`Claude reviewer ${e.REVIEWER}: ${outputs} calls (12 new runs and 3 smoke runs), 15 counted each at least: ${outputs * 15}; with the runs ${p.runCredits + outputs * 15} of the ${e.RC_CAP} cap`);
    const usd = (x) => Math.round(x / p.outputs * outputs * 10000) / 10000;
    console.log(`panel ${p.panel.join(", ")}: ${outputs * 3} calls (${outputs * 6} with one retry each), USD ${usd(p.panelUsdMid)} mid, ${usd(p.panelUsdHigh)} high; cap USD ${e.RC_USD}`);'
  say "smoke runs of konductor-adaptive in $S/runs/smoke: $n (the reply check reviews t1-bug-date-range, t12-mux-parallel-merge and t12-split-shared-file)"
  [ -s "$RC_S/plan.json" ] && say "a frozen reply check plan exists ($RC_S/plan.json): a paid start keeps it"
  say "plan only: nothing was run or spent. Paid: REVIEWER=$REVIEWER bash $0 reply-check"
}

# rc_cell TASK REP: one early-stopped run of the candidate arm, after the cap check (runs and Claude ledger).
rc_cell() {
  local task=$1 rep=$2 U why left rc=0
  local -a A=()
  U=$RC_S/runs/$task/r$rep
  [ -e "$U.done" ] && return 0
  why=$(node "$RCJS" may-run --runs "$RC_S/runs" --ledger "$RC_S/reviews/claude-ledger.jsonl" --cap "$RC_CAP" --run-cap "$RC_RUN_CAP" --run-limit "$RC_RUN_LIMIT") || stop "$why"
  left=${why#left }
  wait_quiet
  [ "$HOST_CHECK" = 0 ] || "$KBIN" whoami >/dev/null 2>&1 || stop "Kiro login expired: run '$KBIN login', then this script again (it resumes)"
  [ "$GIT_CHECK" = 0 ] || [ "$(git -C "$RC_REPO" rev-parse HEAD)" = "$(node -p "require('$RC_S/plan.json').benchSha")" ] || stop "$RC_REPO moved off the reply check's bench pin"
  A=(--arms "$ARM_RC" --suite pack --tasks "$task" --replicates 1 --replicate-offset $((rep - 1)) --parallel 1 --repo-root "$RC_REPO" --hide "$RC_REPO"
    --isolate unshare --seed "$SEED" --model claude-sonnet-5.5 --effort high --agent-engine v3 --kiro-bin "$KBIN" --cache "$CACHE"
    --budget-credits "$left" --run-credit-limit "$RC_RUN_LIMIT" --max-tool-calls "$RC_TOOLS" --out "$U")
  [ -n "$PY312" ] && A+=(--python "$PY312")
  if [ -f "$U/run-config.json" ]; then A+=(--resume)
  elif [ -e "$U" ]; then mkdir -p "$RC_S/incomplete" && mv -- "$U" "$RC_S/incomplete/$task-r$rep.$(date +%s)"; fi
  mkdir -p "$(dirname "$U")"
  say "reply-check $task r$rep: start (may spend up to $RC_RUN_LIMIT; left $left)"
  nice -n 10 node "${BENCH_JS:-$RC_REPO/bench/runner/bench.js}" run "${A[@]}" >> "$U.log" 2>&1 || rc=$?
  case "$rc" in
    0) touch "$U.done"; say "reply-check $task r$rep: done" ;;
    3) stop "bench credit guard stopped reply-check $task r$rep (exit 3)" ;;
    6) stop "login failures (exit 6): run '$KBIN login', then this script again" ;;
    *) stop "bench exit $rc on reply-check $task r$rep (see $U.log); rerun to resume" ;;
  esac
}

rc_paid_mode() {
  local task rep
  local -a T=() R1=()
  rc_reviewer
  tools 1
  [ "$HOST_CHECK" = 0 ] || aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1 || stop "AWS credentials for profile $PROFILE are missing or expired (the panel needs them); refresh them and rerun"
  exec 9> "$OWN_LOCK"
  flock -n 9 || stop "another prompt-fix step holds $OWN_LOCK"
  rc_freeze
  RCJS=$RC_REPO/bench/ops/prompt-fixes/reply-check.js
  mkdir -p "$RC_S/runs" "$RC_S/reviews"
  mapfile -t T < <(node -e 'console.log(require(process.argv[1]).SMOKE.join("\n"))' "$RCJS")
  for rep in $(seq 1 "$RC_REPS"); do for task in "${T[@]}"; do rc_cell "$task" "$rep"; done; done
  node "$RCJS" prompts --runs "$RC_S/runs" --out "$RC_S/prompts" --arm "$RC_NAME" --prefix candidate --early yes > "$RC_S/prompts.log" 2>&1 || stop "prompts failed (see $RC_S/prompts.log)"
  node "$RCJS" prompts --runs "$S/runs/smoke" --out "$RC_S/prompts" --arm konductor-adaptive --prefix smoke --tasks "$RC_SMOKE_PROMPTS" >> "$RC_S/prompts.log" 2>&1 || stop "smoke prompts failed (see $RC_S/prompts.log)"
  say "prompts: $(node -p "Object.keys(require('$RC_S/prompts/manifest.json').entries).length") frozen in $RC_S/prompts"
  R1=(review --prompts "$RC_S/prompts" --out "$RC_S/reviews" --claude "$REVIEWER" --cap "$RC_CAP" --runs "$RC_S/runs" --cap-usd "$RC_USD"
    --work "$RC_S/work" --kiro-bin "${REVIEW_KIRO_BIN:-$KBIN}" --aws-export-profile "$PROFILE" --cache "$CACHE")
  [ -n "${REVIEW_AUTH_DB:-}" ] && R1+=(--auth-db "$REVIEW_AUTH_DB")
  [ -n "${PANEL_MODULE:-}" ] && R1+=(--panel-module "$PANEL_MODULE")
  nice -n 10 node "$RCJS" "${R1[@]}" >> "$RC_S/review.log" 2>&1 || stop "the review stopped: $(tail -1 "$RC_S/review.log") (see $RC_S/review.log); rerun to resume"
  say "$(tail -1 "$RC_S/review.log")"
  node "$RCJS" compare --prompts "$RC_S/prompts" --reviews "$RC_S/reviews" --out "$RC_S/report.md" > /dev/null || stop "compare failed"
  say "reply check done: $RC_S/report.md (the panel majority is the verdict)"
}

main() {
  local mode="" fg=0 yes=0 plan=0 a
  for a in "$@"; do
    case "$a" in
      --plan) plan=1 ;;
      smoke|A|B|C|judge|sign-carddemo-key|rebook|reply-check) [ -z "$mode" ] || usage; mode=$a ;;
      --foreground) fg=1 ;;
      --yes) yes=1 ;;
      *) usage ;;
    esac
  done
  if [ "$plan" = 1 ]; then
    case "$mode" in '') mode=--plan ;; reply-check) mode=reply-check-plan ;; *) usage ;; esac
  fi
  [ -n "$mode" ] || usage
  [ -n "$WS" ] || stop "set KONDUCTOR_WS to the owner workspace (the launcher in <workspace>/scripts sets it)"
  for d in "$S" "$CACHE"; do under_home "$d" && stop "$d is under HOME ($HOME); work dirs go outside it, for example under /var/tmp"; done
  case "$(realpath -m -- "${BASH_SOURCE[0]}")" in "$(realpath -m -- "$R")"/*) stop "run this script from the ops checkout, not from inside R ($R)" ;; esac
  mkdir -p "$S"
  export TMPDIR=/tmp
  STUDY=$R/bench/ops/prompt-fixes/study.js
  case "$mode" in
    --plan) plan_mode; return ;;
    sign-carddemo-key) sign_mode "$yes"; return ;;
    rebook) rebook_mode "$yes"; return ;;
    reply-check-plan) rc_plan_mode; return ;;
  esac
  if [ "$fg" = 0 ]; then
    setsid nohup bash "${BASH_SOURCE[0]}" "$mode" --foreground >> "$S/$mode.log" 2>&1 < /dev/null &
    echo "prompt-fix step $mode started in the background (pid $!). Watch: tail -f $S/$mode.log"
    return 0
  fi
  case "$mode" in
    judge) judge_mode ;;
    reply-check) rc_paid_mode ;;
    *) paid_mode "$mode" ;;
  esac
}
main "$@"
