#!/usr/bin/env bash
# run-judging.sh - judge a finished orchestrator study and write the final reports.
#
# WHAT IT DOES
#   1. Preflight   repo (branch and commit when pinned), opencode binary, study layout, AWS credentials, disk.
#   2. Smoke test  a few real judge calls (cents), when SMOKE names a smoke script. A failing family stops the run before the long part.
#   3. Judging     one cell after another (opencode backend on Bedrock, detailed profile).
#   4. Reports     free: per-cell report, orchestrator-pass, platform verdict per cell, contrast per cell,
#                  all under <study>/reports-judged/.
#   5. Summary     STATE_DIR/judging-summary.txt (spend, calls, errors, verdicts, report paths).
#   The study directory holds one sub-directory per cell (CELLS, default "claude gpt"), each a finished `bench.js run` output.
#
# USAGE (STUDY is required)
#   STUDY=DIR CREDS=FILE bash run-judging.sh              start in the background (survives closing the terminal); returns at once
#   STUDY=DIR bash run-judging.sh --status                last 15 log lines, alive or not, calls done per cell
#   STUDY=DIR CREDS=FILE bash run-judging.sh --foreground run inline in this terminal (output also goes to the log)
#   STUDY=DIR bash run-judging.sh --dry-run               print the plan and the exact commands; runs nothing, needs no credentials
#   Watch it:  tail -f STATE_DIR/judging.log
#   Stop it:   kill -- -"$(cat STATE_DIR/judging.pid)"     (stops the whole process group)
#
# RESUMING
#   Just run the script again. Every finished judge call is cached on disk inside each cell
#   (<cell>/judge/cache), so a rerun after a crash, a Ctrl-C, expired credentials or a budget stop
#   re-spends nothing for finished work and retries calls that failed. The script never deletes study data.
#   The budget cap is per command, so after a budget stop a rerun gets a fresh BUDGET_USD.
#
# ENVIRONMENT (defaults in brackets)
#   STUDY       study directory with the cells                [required]
#   CELLS       space-separated cell directory names          [claude gpt]
#   CREDS       scoped AWS credentials file (path only is used; its contents are never read or printed)   [required for a run]
#   OC          opencode binary                               [opencode on PATH]
#   REPO        checkout to run bench.js from                 [the checkout this script sits in]
#   CLI_JS      bench runner                                  [REPO/bench/runner/bench.js]
#   AWS_PROFILE_NAME, AWS_REGION_NAME   profile inside CREDS and the Bedrock region   [bench, us-east-1]
#   SMOKE       smoke-test script (a node script that prints one JSON line per judge model)   [unset: step 2 is skipped]
#   SMOKE_MODELS  space-separated models the smoke test must report   [unset: every model it prints must be ok]
#   CHANGED_SKILLS  passed to the orchestrator-pass report as --changed-skills   [unset]
#   BUDGET_USD  per-cell budget cap passed to --budget-usd    [15]
#   CONCURRENCY judge calls in flight per cell                [2]
#   STATE_DIR   where judging.log, judging.pid, judging-summary.txt live [/tmp/konductor-bench]
#   Optional checks: EXPECT_RUNS (result.json files per cell), EXPECT_CALLS (judge calls per cell, shown in --status),
#   REQUIRED_COMMIT (must be an ancestor of HEAD), REQUIRED_BRANCH, CREDS_EXPIRY_UTC (a hint, e.g. 2026-01-01T00:00:00Z).
#   MIN_FREE_MB [2048], SCRATCH_PARENT [/tmp] (its path must not contain the word "bench").
#
# CREDENTIALS
#   CREDS is a scoped session file and may expire during a long run. If it does, judge calls fail with "credentials were
#   rejected": re-vend the credentials to the path shown, then rerun this script and it resumes from the cache.
#
# BUDGET
#   --budget-usd is BUDGET_USD per cell and per command. The judge stops starting new calls at 90% of it and marks the
#   skipped records with a judgeError even though it exits 0, so this script reports that as a failure ("skipped by the
#   budget guard") instead of DONE. To continue: BUDGET_USD=25 bash run-judging.sh (finished calls are not paid again).
#
# EXIT CODES: 0 done, 1 failed (preflight, smoke test, a judge cell, or a report), 2 bad usage, 3 a budget stop (hard or 90% guard).

set -u

# ---------------------------------------------------------------- configuration
SELF=$(readlink -f "${BASH_SOURCE[0]}")
DEFAULT_REPO=$(cd "$(dirname "$SELF")/../.." 2>/dev/null && pwd)
STUDY=${STUDY:-}
OC=${OC:-$(command -v opencode || true)}
CREDS=${CREDS:-}
REPO=${REPO:-$DEFAULT_REPO}
CLI_JS=${CLI_JS:-$REPO/bench/runner/bench.js}
SMOKE=${SMOKE:-}
BUDGET_USD=${BUDGET_USD:-15}
CONCURRENCY=${CONCURRENCY:-2}
STATE_DIR=${STATE_DIR:-/tmp/konductor-bench}
EXPECT_RUNS=${EXPECT_RUNS:-}
EXPECT_CALLS=${EXPECT_CALLS:-}
REQUIRED_COMMIT=${REQUIRED_COMMIT:-}
REQUIRED_BRANCH=${REQUIRED_BRANCH:-}
MIN_FREE_MB=${MIN_FREE_MB:-2048}
SMOKE_MODELS=${SMOKE_MODELS:-}
CREDS_EXPIRY_UTC=${CREDS_EXPIRY_UTC:-}
SCRATCH_PARENT=${SCRATCH_PARENT:-/tmp}
AWS_PROFILE_NAME=${AWS_PROFILE_NAME:-bench}
AWS_REGION_NAME=${AWS_REGION_NAME:-us-east-1}
CHANGED_SKILLS=${CHANGED_SKILLS:-}
read -r -a CELLS <<<"${CELLS:-claude gpt}"

LOG="$STATE_DIR/judging.log"
PIDFILE="$STATE_DIR/judging.pid"
SUMMARY="$STATE_DIR/judging-summary.txt"
RJ="$STUDY/reports-judged"

CUR_STEP=0
FAIL_STEP=""
FAIL_REASONS=()
BUDGET_STOP=0
declare -A JUDGE_RC=()
SCRATCH_DIRS=()
NEWDIR=""

# ---------------------------------------------------------------- helpers
say() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

step() {
  CUR_STEP=$1
  printf '\n'
  say "===== STEP $1 of 5: $2 ====="
}

# Record a failure without stopping (used where later steps can still run).
note_failure() {
  local n=$1 reason=$2
  [ -z "$FAIL_STEP" ] && FAIL_STEP=$n
  FAIL_REASONS+=("step $n: $reason")
  say "PROBLEM (step $n): $reason"
}

# Stop the run now.
die() {
  local n=$1 reason=$2
  printf '\n'
  say "FAILED at step $n: $reason"
  exit 1
}

new_scratch() {
  # A fresh scratch dir whose path never contains the word "bench".
  local d
  while :; do
    d=$(mktemp -d "$SCRATCH_PARENT/oc-judge.XXXXXXXX") || return 1
    case "$d" in
      *[Bb][Ee][Nn][Cc][Hh]*) rmdir "$d" ;;
      *) break ;;
    esac
  done
  SCRATCH_DIRS+=("$d")
  NEWDIR=$d
}

drop_scratch() {
  # Only removes dirs this script created itself.
  local d
  for d in "$@"; do
    case "$d" in
      "$SCRATCH_PARENT"/oc-judge.*) rm -rf -- "$d" ;;
    esac
  done
}

# shellcheck disable=SC2329  # invoked through trap
cleanup() {
  drop_scratch "${SCRATCH_DIRS[@]+"${SCRATCH_DIRS[@]}"}"
  if [ -f "$PIDFILE" ] && [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ]; then
    rm -f -- "$PIDFILE"
  fi
}

# shellcheck disable=SC2329  # invoked through trap
on_signal() {
  printf '\n'
  say "FAILED at step $CUR_STEP: interrupted by a signal. Rerun the script to resume; finished calls are cached."
  exit 130
}

is_running() {
  local pid
  [ -f "$PIDFILE" ] || return 1
  pid=$(cat "$PIDFILE" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# run_bench ARGS... : runs `node $CLI_JS ARGS` from the repo with a scratch HOME and a TMPDIR
# without the word "bench", then removes both. Returns the command's exit status.
run_bench() {
  local h t rc
  new_scratch || return 99
  h=$NEWDIR
  new_scratch || return 99
  t=$NEWDIR
  (cd "$REPO" && env -u BENCH_JUDGE_CMD HOME="$h" TMPDIR="$t" node "$CLI_JS" "$@")
  rc=$?
  drop_scratch "$h" "$t"
  return "$rc"
}

print_plan() {
  local h=$1
  printf '%s\n' "$h"
  printf '%s\n' "1. Preflight: repo${REQUIRED_BRANCH:+ branch}${REQUIRED_COMMIT:+/commit}, opencode binary, study layout${EXPECT_RUNS:+ ($EXPECT_RUNS runs per cell)}, AWS credentials, disk."
  if [ -n "$SMOKE" ]; then printf '%s\n' "2. Smoke test: real judge calls from $SMOKE (cents); the long run starts only if they pass."
  else printf '%s\n' "2. Smoke test: skipped, no SMOKE script given."; fi
  printf '%s\n' "3. Judge the cells (${CELLS[*]}) one after another (opencode on Bedrock, detailed profile, concurrency $CONCURRENCY)."
  printf '%s\n' "4. Reports (free) into $RJ: per cell, orchestrator-pass, platform verdict, contrast."
  printf '%s\n' "5. Summary to $SUMMARY: spend, calls, errors, verdict lines, report paths."
  printf '%s\n' "Budget cap \$$BUDGET_USD per cell. Rerun resumes from cache."
}

# ---------------------------------------------------------------- command lines (shared by --dry-run and the real run)
judge_args() {
  printf '%s\n' judge --run "$STUDY/$1" --judge-backend opencode --opencode-bin "$OC" \
    --aws-creds-file "$CREDS" --aws-profile "$AWS_PROFILE_NAME" --aws-region "$AWS_REGION_NAME" \
    --profile detailed --concurrency "$CONCURRENCY" --budget-usd "$BUDGET_USD"
}

# Each line: <name>|<args...>
report_specs() {
  local c all=""
  for c in "${CELLS[@]}"; do
    printf '%s\n' "report-$c|report --run $STUDY/$c --profile detailed --baseline vanilla --out $RJ/report-$c"
    all="${all:+$all,}$STUDY/$c"
  done
  printf '%s\n' "pass|report --run $all --verdict orchestrator-pass${CHANGED_SKILLS:+ --changed-skills $CHANGED_SKILLS} --out $RJ/pass"
  for c in "${CELLS[@]}"; do
    printf '%s\n' "platform-$c|report --run $STUDY/$c --verdict platform --out $RJ/platform-$c"
  done
  for c in "${CELLS[@]}"; do
    printf '%s\n' "contrast-$c|contrast --run $STUDY/$c --base vanilla --out $RJ/contrast-$c"
  done
}

dry_run() {
  local c name args
  print_plan "Orchestrator study judging: DRY RUN (nothing is executed, no credentials needed)"
  printf '\nResolved configuration:\n'
  printf '  STUDY=%s\n  CELLS=%s\n  OC=%s\n  CREDS=%s (path only)\n  REPO=%s\n  SMOKE=%s\n  BUDGET_USD=%s  CONCURRENCY=%s\n  LOG=%s\n  SUMMARY=%s\n' \
    "$STUDY" "${CELLS[*]}" "${OC:-(unset)}" "${CREDS:-(unset)}" "$REPO" "${SMOKE:-(unset)}" "$BUDGET_USD" "$CONCURRENCY" "$LOG" "$SUMMARY"
  printf '\nStep 1 checks: branch == %s, HEAD contains %s, %s executable, each cell under %s with %s result.json,\n' \
    "${REQUIRED_BRANCH:-(any)}" "${REQUIRED_COMMIT:-(any)}" "${OC:-(unset)}" "$STUDY" "${EXPECT_RUNS:-at least one}"
  printf '  credentials via: AWS_SHARED_CREDENTIALS_FILE=%s AWS_PROFILE=%s aws bedrock list-foundation-models --region %s --query "length(modelSummaries)"\n' \
    "${CREDS:-(unset)}" "$AWS_PROFILE_NAME" "$AWS_REGION_NAME"
  printf '  existing judgments.json must be from the opencode backend; free disk >= %s MB.\n' "$MIN_FREE_MB"
  printf '\nStep 2 command (scratch HOME and TMPDIR):\n  (cd %s && HOME=<scratch> TMPDIR=<scratch> node %s)\n' "$REPO" "${SMOKE:-(skipped: SMOKE is unset)}"
  printf '\nStep 3 commands (each with its own scratch HOME and TMPDIR; run in %s):\n' "$REPO"
  for c in "${CELLS[@]}"; do
    printf '  HOME=<scratch> TMPDIR=<scratch> node %s' "${CLI_JS#"$REPO"/}"
    judge_args "$c" | while IFS= read -r a; do printf ' %q' "$a"; done
    printf '\n'
  done
  printf '\nStep 4 commands (same scratch handling):\n'
  report_specs | while IFS='|' read -r name args; do
    printf '  node %s %s\n' "${CLI_JS#"$REPO"/}" "$args"
  done
  printf '\nStep 5: writes %s\n' "$SUMMARY"
  return 0
}

# ---------------------------------------------------------------- step 1
step1_preflight() {
  step 1 "Preflight"
  local b head c n free have

  for have in node git aws find df; do
    command -v "$have" >/dev/null 2>&1 || die 1 "required tool '$have' is not on PATH"
  done

  [ -d "$REPO/.git" ] || [ -f "$REPO/.git" ] || die 1 "repo not found at $REPO"
  b=$(git -C "$REPO" branch --show-current 2>/dev/null)
  if [ -n "$REQUIRED_BRANCH" ]; then
    [ "$b" = "$REQUIRED_BRANCH" ] || die 1 "repo $REPO is on branch '${b:-detached HEAD}', expected '$REQUIRED_BRANCH'. Check it out first."
  fi
  head=$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null)
  if [ -n "$REQUIRED_COMMIT" ]; then
    git -C "$REPO" merge-base --is-ancestor "$REQUIRED_COMMIT" HEAD 2>/dev/null \
      || die 1 "repo HEAD ($head) does not contain the required commit $REQUIRED_COMMIT as an ancestor"
  fi
  [ -f "$CLI_JS" ] || die 1 "$CLI_JS is missing"
  say "repo ok: branch ${b:-detached}, HEAD $head${REQUIRED_COMMIT:+ contains $REQUIRED_COMMIT}"

  [ -n "$OC" ] && [ -x "$OC" ] || die 1 "opencode binary not found or not executable: ${OC:-(unset)}. Set OC or put opencode on PATH"
  say "opencode binary ok: $OC"

  for c in "${CELLS[@]}"; do
    [ -d "$STUDY/$c" ] || die 1 "study cell missing: $STUDY/$c"
    n=$(find "$STUDY/$c" -name result.json 2>/dev/null | wc -l)
    if [ -n "$EXPECT_RUNS" ]; then
      [ "$n" -eq "$EXPECT_RUNS" ] || die 1 "cell $c has $n result.json files, expected $EXPECT_RUNS (is the study finished?)"
    else
      [ "$n" -gt 0 ] || die 1 "cell $c has no result.json files (is the study finished?)"
    fi
    say "cell $c ok: $n result.json"
  done

  case "$SCRATCH_PARENT" in
    *[Bb][Ee][Nn][Cc][Hh]*) die 1 "SCRATCH_PARENT '$SCRATCH_PARENT' contains the word 'bench'; pick another path" ;;
  esac
  mkdir -p "$STATE_DIR" "$RJ" 2>/dev/null || die 1 "cannot create $STATE_DIR or $RJ"

  for c in "${CELLS[@]}"; do check_prior_state "$c" || exit 1; done

  free=$(df -Pk "$SCRATCH_PARENT" | awk 'NR==2 {print int($4/1024)}')
  [ "${free:-0}" -ge "$MIN_FREE_MB" ] || die 1 "only ${free:-0} MB free in $SCRATCH_PARENT, need $MIN_FREE_MB MB"
  free=$(df -Pk "$STUDY" | awk 'NR==2 {print int($4/1024)}')
  [ "${free:-0}" -ge "$MIN_FREE_MB" ] || die 1 "only ${free:-0} MB free next to $STUDY, need $MIN_FREE_MB MB"
  say "disk ok: at least $MIN_FREE_MB MB free"

  check_credentials
  say "preflight passed"
}

# A finished or partial earlier run is fine as long as it used the opencode backend (one backend per study).
check_prior_state() {
  local c=$1 j cache backend cached
  j="$STUDY/$c/judgments.json"
  cache="$STUDY/$c/judge/cache"
  cached=0
  [ -d "$cache" ] && cached=$(find "$cache" -name '*.json' 2>/dev/null | wc -l)
  if [ -f "$j" ]; then
    backend=$(node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).backend||"kiro"))}catch(e){process.stdout.write("unreadable")}' "$j")
    if [ "$backend" != "opencode" ]; then
      say "FAILED at step 1: $j was written by the '$backend' backend; one backend per study. Move it aside by hand if you really want to rejudge."
      return 1
    fi
    say "cell $c: judgments.json from an earlier opencode run exists; resuming ($cached finished calls cached)"
  elif [ "$cached" -gt 0 ]; then
    say "cell $c: partial earlier run found; resuming ($cached finished calls cached)"
  else
    say "cell $c: no earlier judging; starting fresh"
  fi
  return 0
}

check_credentials() {
  local out rc now exp remain
  [ -n "$CREDS" ] || die 1 "CREDS is not set: point CREDS at the scoped AWS credentials file (only the path is used)"
  [ -f "$CREDS" ] || die 1 "AWS credentials file not found: $CREDS. Re-vend the credentials to that path and rerun."
  [ -r "$CREDS" ] || die 1 "AWS credentials file is not readable: $CREDS"

  now=$(date -u +%s)
  exp=0
  [ -n "$CREDS_EXPIRY_UTC" ] && exp=$(date -u -d "$CREDS_EXPIRY_UTC" +%s 2>/dev/null || echo 0)
  if [ "$exp" -gt 0 ]; then
    remain=$((exp - now))
    if [ "$remain" -le 0 ]; then
      say "WARNING: the credentials were due to expire at $CREDS_EXPIRY_UTC, which has passed; the live check below decides."
    elif [ "$remain" -lt 21600 ]; then
      say "WARNING: credentials expire at $CREDS_EXPIRY_UTC, in about $((remain / 3600)) h $(((remain % 3600) / 60)) min. If they expire mid-run, re-vend and rerun to resume."
    else
      say "credentials expected to last until $CREDS_EXPIRY_UTC (about $((remain / 3600)) h from now)"
    fi
  fi

  # Cheap read-only call. Only the exit status and the error class are used; credential contents are never read here.
  out=$(env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE \
        AWS_SHARED_CREDENTIALS_FILE="$CREDS" AWS_CONFIG_FILE=/dev/null AWS_PROFILE="$AWS_PROFILE_NAME" \
        aws bedrock list-foundation-models --region "$AWS_REGION_NAME" --query 'length(modelSummaries)' --output text 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then
    say "credentials ok (Bedrock list call succeeded)"
    return 0
  fi
  if printf '%s' "$out" | grep -qiE 'AccessDenied|not authorized|UnauthorizedOperation'; then
    say "NOTE: the scoped session cannot call ListFoundationModels (access denied). That does not mean it is expired; the smoke test in step 2 is the real check."
    return 0
  fi
  if printf '%s' "$out" | grep -qiE 'ExpiredToken|expired|InvalidClientTokenId|UnrecognizedClient|security token|could not be found|Unable to locate credentials|ProfileNotFound|SignatureDoesNotMatch|InvalidSignature'; then
    die 1 "credentials expired: re-vend the credentials to $CREDS and rerun"
  fi
  # Unknown failure (network, DNS, aws CLI problem): show the error class only, then stop.
  say "aws call failed with: $(printf '%s' "$out" | grep -oE 'An error occurred \([A-Za-z]+\)' | head -1)"
  die 1 "credentials expired or Bedrock is unreachable: re-vend the credentials to $CREDS and rerun (check the network if that does not help)"
}

# ---------------------------------------------------------------- step 2
step2_smoke() {
  step 2 "Smoke test (a few real calls, cents)"
  local h t out rc
  if [ -z "$SMOKE" ]; then say "no SMOKE script given; skipping the smoke test"; return 0; fi
  [ -f "$SMOKE" ] || die 2 "smoke script not found: $SMOKE"
  new_scratch || die 2 "cannot create a scratch directory"
  h=$NEWDIR
  new_scratch || die 2 "cannot create a scratch directory"
  t=$NEWDIR
  out="$STATE_DIR/smoke-last.txt"
  say "running $SMOKE"
  (cd "$REPO" && env -u BENCH_JUDGE_CMD HOME="$h" TMPDIR="$t" node "$SMOKE") >"$out" 2>&1
  rc=$?
  drop_scratch "$h" "$t"
  sed 's/^/    smoke| /' "$out"

  local verdict
  verdict=$(node - "$out" "$rc" "$SMOKE_MODELS" <<'NODE'
const fs = require('fs');
const [file, rc, models] = process.argv.slice(2);
const seen = {};
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.startsWith('{')) continue;
  let r; try { r = JSON.parse(line); } catch { continue; }
  if (r && r.model) seen[r.model] = r;
}
const bad = [];
const wanted = models.split(/\s+/).filter(Boolean);
for (const m of wanted.length ? wanted : Object.keys(seen)) {
  const r = seen[m];
  if (!r) bad.push(`${m}: no result printed`);
  else if (r.error) bad.push(`${m}: ${String(r.error).slice(0, 300)}`);
  else if (r.jsonOk === false) bad.push(`${m}: reply was not valid JSON`);
  else console.log(`OK ${m}`);
}
if (!wanted.length && !Object.keys(seen).length) bad.push('the smoke script printed no result');
if (rc !== '0') bad.push(`smoke script exit status ${rc}`);
if (bad.length) { console.log('FAIL ' + bad.join(' | ')); process.exit(1); }
NODE
  )
  local vrc=$?
  printf '%s\n' "$verdict" | sed 's/^/    /'
  if [ "$vrc" -ne 0 ]; then
    die 2 "smoke test failed, long run not started: $(printf '%s' "$verdict" | grep '^FAIL' | head -1 | sed 's/^FAIL //')"
  fi
  say "smoke test passed"
}

# ---------------------------------------------------------------- step 3
step3_judge() {
  step 3 "Judge the cells (safe to interrupt and rerun, finished calls are cached)"
  local c rc t0 args
  for c in "${CELLS[@]}"; do
    say "judging cell '$c' -> $STUDY/$c  (budget cap \$$BUDGET_USD; rerunning this script resumes from cache)"
    t0=$(date +%s)
    mapfile -t args < <(judge_args "$c")
    run_bench "${args[@]}" 2>&1 | tee -a "$STATE_DIR/judge-$c.log"
    rc=${PIPESTATUS[0]}
    JUDGE_RC[$c]=$rc
    say "cell '$c' finished with exit status $rc after $(( ($(date +%s) - t0) / 60 )) min"
    case "$rc" in
      0) check_cell_errors "$c" ;;
      3) BUDGET_STOP=1
         note_failure 3 "cell $c hit the \$$BUDGET_USD budget hard stop (exit 3); rerun to continue (BUDGET_USD=<higher> bash $SELF to raise the cap)" ;;
      *) note_failure 3 "judging cell $c exited with status $rc (see $STATE_DIR/judge-$c.log); rerun to resume" ;;
    esac
  done
}

# A judge exit status of 0 can still hide skipped or failed calls (the budget guard stops new calls at 90% and
# marks those records with a judgeError). Failed calls are not cached, so a rerun retries exactly those.
check_cell_errors() {
  local c=$1 info total budget
  info=$(node -e '
    const fs = require("fs");
    try {
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const e = [...(j.rubric || []), ...(j.pairwise || []), ...(j.graded || [])].filter((r) => r.judgeError);
      const b = e.filter((r) => /budget reached/.test(String(r.judgeError))).length;
      console.log(e.length + " " + b + " " + (j.notJudged || []).length);
    } catch (e) { console.log("unreadable 0 0"); }' "$STUDY/$c/judgments.json")
  read -r total budget _ <<<"$info"
  if [ "$total" = "unreadable" ]; then
    note_failure 3 "cell $c: judgments.json is missing or unreadable after the judge finished"
  elif [ "$total" -gt 0 ]; then
    if [ "$budget" -gt 0 ]; then
      BUDGET_STOP=1
      note_failure 3 "cell $c: $budget record(s) skipped by the budget guard (stops at 90% of \$$BUDGET_USD). Rerun to finish; raise the cap with BUDGET_USD=<higher> bash $SELF"
    else
      note_failure 3 "cell $c: $total record(s) have judge errors (failed calls are not cached); rerun to retry them"
    fi
  fi
}

# ---------------------------------------------------------------- step 4
step4_reports() {
  step 4 "Reports (free) into $RJ"
  local name args rc
  mkdir -p "$RJ" || { note_failure 4 "cannot create $RJ"; return; }
  while IFS='|' read -r name args; do
    say "report: $name"
    # shellcheck disable=SC2086  # args is a controlled, space-separated flag list without spaces in values
    # Full output goes to the .stdout.txt file; the log shows the first 12 lines only.
    run_bench $args 2>&1 | tee "$RJ/$name.stdout.txt" | sed -n '1,12s/^/    /p'
    rc=${PIPESTATUS[0]}
    [ "$rc" -eq 0 ] || note_failure 4 "'$name' exited with status $rc (see $RJ/$name.stdout.txt)"
  done < <(report_specs)
}

# ---------------------------------------------------------------- step 5
step5_summary() {
  step 5 "Summary -> $SUMMARY"
  local status_lines="" c
  for c in "${CELLS[@]}"; do
    status_lines+="$c=${JUDGE_RC[$c]:-not-run};"
  done
  node - "$STUDY" "$RJ" "$status_lines" "$BUDGET_USD" "${CELLS[*]}" <<'NODE' | tee "$SUMMARY"
const fs = require('fs');
const path = require('path');
const [study, rj, statusLines, budget, cellList] = process.argv.slice(2);
const cells = cellList.split(/\s+/).filter(Boolean);
const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const out = [];
const p = (s = '') => out.push(s);
const usd = (n) => (typeof n === 'number' ? `$${n.toFixed(4)}` : 'n/a');
const exits = Object.fromEntries(statusLines.split(';').filter(Boolean).map((x) => x.split('=')));

p(`Judging summary, generated ${new Date().toISOString()}`);
p(`Study: ${study}`);
p(`Budget cap per cell and command: $${budget}`);
p();
p('Judging per cell');
for (const cell of cells) {
  const j = read(path.join(study, cell, 'judgments.json'));
  p(`- ${cell}: judge exit status ${exits[cell] ?? 'unknown'}`);
  if (!j) { p('    judgments.json missing or unreadable, so nothing was judged'); continue; }
  const inv = j.invocations || [];
  const calls = inv.reduce((s, x) => s + (x.calls || 0), 0);
  const cached = inv.reduce((s, x) => s + (x.cachedCalls || 0), 0);
  const recs = [...(j.rubric || []), ...(j.pairwise || []), ...(j.graded || [])];
  const parseFailures = recs.reduce((s, r) => s + (typeof r.parseFailures === 'number' ? r.parseFailures : 0), 0);
  const errors = recs.filter((r) => r.judgeError);
  const byJudge = {};
  for (const r of errors) byJudge[r.judge] = (byJudge[r.judge] || 0) + 1;
  p(`    backend ${j.backend}, subject ${j.subjectModel}, judges ${(j.judges || []).join(', ')}`);
  p(`    spent ${usd(j.spentUsd)} over ${inv.length} invocation(s) (${Object.entries(j.spentUsdByJudge || {}).map(([k, v]) => `${k} ${usd(v)}`).join(', ')})`);
  p(`    calls ${calls} (${cached} served from cache), records: ${(j.rubric || []).length} rubric, ${(j.pairwise || []).length} pairwise, ${(j.graded || []).length} graded`);
  p(`    parse failures ${parseFailures}, judge errors ${errors.length}${errors.length ? ` (${Object.entries(byJudge).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}, runs not judged ${(j.notJudged || []).length}`);
  if (errors.length) p('    judge errors were not cached: rerun the script to retry them');
}

p();
p('Orchestrator pass rule (cell | arm | call)');
const pass = read(path.join(rj, 'pass', 'orchestrator-pass.json'));
if (!pass) p('    report missing: pass/orchestrator-pass.json');
else {
  for (const c of pass.cells || []) {
    for (const a of c.arms || []) {
      const why = a.aaRepeatOf ? `A/A repeat of ${a.aaRepeatOf}` : (a.reasons || []).slice(0, 2).join('; ');
      p(`- ${c.key || `${c.harnessLabel} / ${c.model}`} | ${a.label} | ${a.call}${why ? ` | ${why}` : ''}`);
    }
  }
}

p();
p('Platform verdict (arm | verdict)');
for (const cell of cells) {
  const v = read(path.join(rj, `platform-${cell}`, 'verdict.json'));
  p(`${cell}:`);
  if (!v) { p('    report missing'); continue; }
  for (const a of v.arms || []) p(`- ${a.label} | ${a.verdict}${a.aaRepeatOf ? ` (A/A repeat of ${a.aaRepeatOf})` : ''}`);
}

p();
p('Reports');
if (fs.existsSync(rj)) {
  for (const d of fs.readdirSync(rj).sort()) {
    const full = path.join(rj, d);
    if (fs.statSync(full).isDirectory()) p(`- ${full}/`);
  }
}
console.log(out.join('\n'));
NODE
  [ "${PIPESTATUS[0]}" -eq 0 ] || note_failure 5 "could not write the summary"
}

# ---------------------------------------------------------------- status
show_status() {
  local c cache ok n st
  printf 'Log: %s\n' "$LOG"
  if is_running; then
    printf 'Process: RUNNING (pid %s)\n' "$(cat "$PIDFILE")"
  else
    printf 'Process: not running\n'
  fi
  if [ -f "$LOG" ]; then
    st=$(grep -E '===== STEP' "$LOG" | tail -1)
    [ -n "$st" ] && printf 'Last step started: %s\n' "$st"
  fi
  printf '\nCalls done per cell (finished calls cached in <cell>/judge/cache%s):\n' "${EXPECT_CALLS:+; expected about $EXPECT_CALLS per cell}"
  for c in "${CELLS[@]}"; do
    cache="$STUDY/$c/judge/cache"
    n=0
    [ -d "$cache" ] && n=$(find "$cache" -name '*.json' 2>/dev/null | wc -l)
    if [ -f "$STUDY/$c/credit-ledger.jsonl" ]; then
      # shellcheck disable=SC2016  # the JS program is deliberately single-quoted
      ok=$(node -e '
        const fs=require("fs");let lines=0,okc=0,usd=0;
        for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n")){ if(!l)continue; let r;try{r=JSON.parse(l)}catch{continue}
          if(r.kind!=="judge")continue; lines++; if(r.ok)okc++; if(!r.cached&&typeof r.usd==="number")usd+=r.usd; }
        process.stdout.write(`${lines} ledger entries, ${okc} ok, live spend $${usd.toFixed(4)}`);' "$STUDY/$c/credit-ledger.jsonl")
    else
      ok="no ledger yet"
    fi
    st=""
    [ -f "$STUDY/$c/judgments.json" ] && st=", judgments.json written"
    printf '  %-7s %s cached calls%s; %s%s\n' "$c" "$n" "${EXPECT_CALLS:+ of about $EXPECT_CALLS}" "$ok" "$st"
  done
  printf '\nLast 15 log lines:\n'
  if [ -f "$LOG" ]; then tail -n 15 "$LOG" | sed 's/^/  | /'; else printf '  (no log yet: nothing has been started)\n'; fi
  if is_running; then
    printf '\nStop: kill -- -%s\n' "$(cat "$PIDFILE")"
  fi
}

# ---------------------------------------------------------------- launch / main
launch_background() {
  local pid
  if is_running; then
    printf 'Already running (pid %s). Use: bash %s --status\n' "$(cat "$PIDFILE")" "$SELF"
    exit 1
  fi
  mkdir -p "$STATE_DIR" || { printf 'cannot create %s\n' "$STATE_DIR"; exit 1; }
  print_plan "Orchestrator study judging"
  printf -- '---- launched %s ----\n' "$(date -u +%FT%TZ)" >>"$LOG"
  setsid nohup bash "$SELF" --child >>"$LOG" 2>&1 </dev/null &
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -f "$PIDFILE" ] && break
    sleep 0.5
  done
  pid=$(cat "$PIDFILE" 2>/dev/null || echo "?")
  printf '\nStarted in the background (pid %s). It keeps running if you close this terminal.\n' "$pid"
  printf '  Watch:   tail -f %s\n' "$LOG"
  printf '  Status:  bash %s --status\n' "$SELF"
  printf '  Resume:  if it stops for any reason, run: bash %s   (finished calls are cached)\n' "$SELF"
  exit 0
}

run_all() {
  # Own the pidfile so --status works in both foreground and background modes.
  if is_running && [ "$(cat "$PIDFILE")" != "$$" ]; then
    say "FAILED at step 0: another judging run is already active (pid $(cat "$PIDFILE"))"
    exit 1
  fi
  printf '%s\n' "$$" >"$PIDFILE"
  trap cleanup EXIT
  trap on_signal INT TERM HUP

  print_plan "Orchestrator study judging ($(date -u +%FT%TZ))"
  step1_preflight
  step2_smoke
  step3_judge
  step4_reports
  step5_summary

  printf '\n'
  if [ -n "$FAIL_STEP" ]; then
    {
      printf 'Result: FAILED at step %s\n' "$FAIL_STEP"
      printf '  %s\n' "${FAIL_REASONS[@]}"
    } >>"$SUMMARY"
    say "FAILED at step $FAIL_STEP: ${FAIL_REASONS[0]#step *: }"
    local r
    for r in "${FAIL_REASONS[@]:1}"; do say "  also: $r"; done
    say "Summary: $SUMMARY. Rerun 'bash $SELF' to resume from cache."
    [ "$BUDGET_STOP" -eq 1 ] && exit 3
    exit 1
  fi
  printf 'Result: DONE\n' >>"$SUMMARY"
  say "DONE. Summary: $SUMMARY  Reports: $RJ"
  exit 0
}

main() {
  case "${1:-}" in
    -h|--help) ;;
    --status|--dry-run|--foreground|--child|"")
      [ -n "$STUDY" ] || { printf 'STUDY is not set: point STUDY at the study directory (see --help)\n' >&2; exit 2; } ;;
  esac
  case "${1:-}" in
    --status) show_status; exit 0 ;;
    --dry-run) dry_run; exit 0 ;;
    --foreground)
      mkdir -p "$STATE_DIR" || { printf 'cannot create %s\n' "$STATE_DIR"; exit 1; }
      exec > >(tee -a "$LOG") 2>&1
      run_all ;;
    --child) run_all ;;
    "") launch_background ;;
    -h|--help) awk 'NR>1 && /^set -u/ {exit} NR>1 {sub(/^# ?/, ""); print}' "$SELF"; exit 0 ;;
    *) printf 'unknown option: %s (use --status, --foreground, --dry-run)\n' "$1" >&2; exit 2 ;;
  esac
}

main "$@"
