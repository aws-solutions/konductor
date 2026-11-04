#!/usr/bin/env bash
# run-real-pilot.sh - a capability study over the real and pilot suites: vanilla against the konductor arms, task by task.
#
# WHAT IT DOES
#   Reads the task list from TASKS_FILE and runs each task as its own `bench.js run` into $V/<suite>-<task>, because the
#   runner has no resume or skip-completed mode and every invocation overwrites run-config.json and summary.json in its --out.
#   Arms (ARMS overrides the whole list):
#       vanilla
#       orch-all=dir:$ORCH_DIR     only when ORCH_DIR names a worktree of the branch under test
#       main                       origin/main as last fetched
#   --profile detailed: 5 replicates per cell, plus an A/A repeat of the FIRST konductor arm. List the arm under test first.
#   A task dir is "complete" when its summary.json is not interrupted, its isolation gate is ok, and it holds
#   tasks x arms x replicates results. Complete dirs are skipped; an incomplete dir is MOVED to $V/incomplete/<name>-<UTC>
#   and the task re-runs from scratch. Nothing is deleted.
#   At the end it writes the free (no model call) orchestrator-pass and platform verdict reports, pooled over all task
#   dirs, to $V/reports-prejudge/. Judging is a separate step (needs credentials): see run-after-capability.sh.
#
# USAGE
#   bash run-real-pilot.sh                 preflight, then daemonize (setsid nohup) and return
#   bash run-real-pilot.sh --foreground    preflight, then run in this terminal
#   bash run-real-pilot.sh --dry-run       preflight (no builds), print the plan and exact commands, run nothing
#   bash run-real-pilot.sh --preflight     preflight plus `--prepare-only` of the arm set (free), run nothing
#   bash run-real-pilot.sh --status        done/total tasks, run counts, credits, last 10 log lines, ETA
#   bash run-real-pilot.sh --stop          SIGTERM the daemon (the runner flushes summary.json as interrupted)
#   SMOKE=1 bash run-real-pilot.sh         cheap smoke test (vanilla, 1 replicate), results in a separate
#                                          real-pilot-smoke-<UTC> dir, never in the study dir
#
# RESUME: rerun `bash run-real-pilot.sh`. The study dir V is read from STATE_DIR/real-pilot.study. Complete task dirs
#   are skipped; the interrupted one is moved to $V/incomplete/ and re-run. A lost task costs at most one task dir.
#
# TASKS_FILE: one task per line, `suite|task|timeoutSec|kind|estSecPerTaskDir`; blank lines and lines starting with # are
#   ignored. kind is real (needs --real-cache), lite, or auton (autonomy tier, scripted user). Default:
#   real-pilot-tasks.txt next to this script.
#
# ENVIRONMENT (defaults in brackets)
#   REPO          checkout to run from                                  [the checkout this script sits in]
#   STATE_DIR     pid, log, study pointer, caches                       [/tmp/konductor-bench]
#   RESULTS       where study dirs go                                   [STATE_DIR/results]
#   TASKS_FILE    task list                                             [real-pilot-tasks.txt beside this script]
#   ORCH_DIR      worktree of the branch under test; adds the arm orch-all=dir:ORCH_DIR   [unset]
#   ARMS          full --arms value                                     [vanilla,orch-all=dir:ORCH_DIR,main, or vanilla,main without ORCH_DIR]
#   N_ARMS        arms per task dir including the A/A repeat            [number of ARMS, plus 1 when ARMS has a konductor arm]
#   REPS          replicates per cell                                   [5]
#   MODEL, ENGINE, SEED   passed to bench.js                            [claude-sonnet-5.5, v3, 1]
#   EXPECT_BRANCH, EXPECT_ORCH_SHA, EXPECT_MAIN_SHA   pin the branch and the commits the study depends on. Unset: the
#                 branch is not checked and the commits seen at launch are pinned for the whole study.
#   CACHE, CARGO_TARGET, REAL_CACHE   arm cache, cargo target dir, real-repo cache   [STATE_DIR/cache, STATE_DIR/cargo-target, $BENCH_REAL_CACHE or STATE_DIR/realrepos]
#   ARM_CACHES    space-separated arm cache dirs that must exist before launch       [none]
#   AUTH_DB       kiro-cli auth database                                [~/.local/share/kiro-cli/data.sqlite3]
#   KIRO_CLI      kiro-cli binary                                       [kiro-cli]
#   CLI_JS        bench runner                                          [REPO/bench/runner/bench.js]
#   AUTONOMY      1 includes the autonomy tasks without the smoke marker file, 0 skips them   [auto: the marker file decides]
#   SMOKE_REAL_TASK, SMOKE_AUTON_TASK   smoke-test tasks                [first real and first auton task of TASKS_FILE]
#   PROBE_BENCH   bench dir holding a two-turn probe task for the resume check; PROBE_SUITE [autonomy], PROBE_TASK [probe-hello]. Unset: the probe is skipped.
#   MIN_FREE_GB [20], MIN_FREE_GB_TMPFS [10], MIN_MEM_GB [8], SCRATCH_PARENT [/tmp, its path must not contain "bench"]
#   Test-only: NO_KIRO_CHECK, NO_ISOLATION_CHECK, BENCH_PROC_PATTERN
#
# ISOLATION: do NOT run `konductor install` or `konductor update` (or anything else that writes the real
#   ~/.konductor/installs) while this runs. The runner hashes that directory before and after every run and
#   batch; any change fails the batch (exit 4, "ISOLATION FAILURE") and this script stops with FAILED.
#   Also do not switch branches, edit bench/ or `git fetch` in the checkout, or touch ORCH_DIR:
#   the script checks HEAD, bench/ cleanliness, origin/main and ORCH_DIR between tasks and stops if they move.
#   Every bench.js call runs with a scratch HOME and a TMPDIR whose path has no "bench" in it; both are removed.
#
# COST: no credit cap is set and this script passes no --budget-credits. The running credit total is logged after every
#   task dir. Plan for several minutes per run: tasks x arms x replicates runs in total.
#
# AUTONOMY TASKS (kind auton): run only if the smoke test proved the scripted-user/--resume-id tier on the engine
#   (marker file STATE_DIR/real-pilot.autonomy-ENGINE) or AUTONOMY=1. Otherwise a "SKIPPED (autonomy tier unsupported ...)"
#   line is printed and the other tasks run.

set -u -o pipefail

# ---------------------------------------------------------------- configuration
SCRIPT=$(readlink -f "${BASH_SOURCE[0]}")
DEFAULT_REPO=$(cd "$(dirname "$SCRIPT")/../.." 2>/dev/null && pwd)
REPO=${REPO:-$DEFAULT_REPO}
BASE=${STATE_DIR:-/tmp/konductor-bench}
CLI_JS=${CLI_JS:-$REPO/bench/runner/bench.js}
TASKS_FILE=${TASKS_FILE:-$(dirname "$SCRIPT")/real-pilot-tasks.txt}
ORCH_DIR=${ORCH_DIR:-}
LOG=$BASE/real-pilot.log
PIDFILE=$BASE/real-pilot.pid
STUDYFILE=$BASE/real-pilot.study
AUTONOMY_MARKER=$BASE/real-pilot.autonomy-${ENGINE:-v3}
CACHE=${CACHE:-$BASE/cache}
CARGO_TARGET=${CARGO_TARGET:-$BASE/cargo-target}
REAL_CACHE=${REAL_CACHE:-${BENCH_REAL_CACHE:-$BASE/realrepos}}
RESULTS=${RESULTS:-$BASE/results}
REAL_HOME=$(getent passwd "$(id -un)" | cut -d: -f6)
AUTH_DB=${AUTH_DB:-$REAL_HOME/.local/share/kiro-cli/data.sqlite3}
KIRO=${KIRO_CLI:-kiro-cli}
SCRATCH_PARENT=${SCRATCH_PARENT:-/tmp}
BENCH_PROC_PATTERN=${BENCH_PROC_PATTERN:-'bench/runner/bench\.js'}
ARM_CACHES=${ARM_CACHES:-}

EXPECT_BRANCH=${EXPECT_BRANCH:-}
EXPECT_ORCH_SHA=${EXPECT_ORCH_SHA:-}
EXPECT_MAIN_SHA=${EXPECT_MAIN_SHA:-}
ENGINE=${ENGINE:-v3}
MODEL=${MODEL:-claude-sonnet-5.5}
SEED=${SEED:-1}
if [ -n "${ARMS:-}" ]; then :
elif [ -n "$ORCH_DIR" ]; then ARMS="vanilla,orch-all=dir:$ORCH_DIR,main"
else ARMS="vanilla,main"; fi
REPS=${REPS:-5}
if [ -z "${N_ARMS:-}" ]; then # every arm, plus the A/A repeat of the first konductor arm
  N_ARMS=$(awk -F, '{ n = NF; for (i = 1; i <= NF; i++) if ($i != "vanilla") k = 1; print n + k }' <<<"$ARMS")
fi
EXPECT_RUNS=$((N_ARMS * REPS)) # per single-task dir

MIN_FREE_GB=${MIN_FREE_GB:-20}              # disk-backed results filesystem
MIN_FREE_GB_TMPFS=${MIN_FREE_GB_TMPFS:-10}  # results on a RAM-backed tmpfs
MIN_MEM_GB=${MIN_MEM_GB:-8}
ABORT_FREE_GB=3                             # between tasks: stop cleanly below this

# Each TASKS entry is suite|task|timeoutSec|kind|estSecPerTaskDir, read from TASKS_FILE.
TASKS=()
if [ -r "$TASKS_FILE" ]; then
  mapfile -t TASKS < <(sed -e 's/[[:space:]]*$//' -e '/^[[:space:]]*#/d' -e '/^$/d' "$TASKS_FILE")
fi

MODE=daemon
for a in "$@"; do
  case "$a" in
    --foreground) MODE=foreground ;;
    --dry-run) MODE=dry-run ;;
    --status) MODE=status ;;
    --stop) MODE=stop ;;
    --preflight|--prepare-only) MODE=preflight ;;
    -h|--help) awk 'NR>1 && /^set -u/ {exit} NR>1 {sub(/^# ?/, ""); print}' "$SCRIPT"; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done
SMOKE=${SMOKE:-0}
[ "${RP_CHILD:-0}" = 1 ] && MODE=foreground

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() { printf '[%s] %s\n' "$(ts)" "$*"; }
die() { say "FAILED: $*"; exit 1; }

# ---------------------------------------------------------------- helper (node) for JSON work
HELPER_JS=$(cat <<'JS'
const fs = require('fs'), path = require('path');
const [cmd, ...a] = process.argv.slice(1);
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const ledger = (dir) => {
  let t = ''; try { t = fs.readFileSync(path.join(dir, 'credit-ledger.jsonl'), 'utf8'); } catch { return []; }
  return t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
};
if (cmd === 'complete') {            // dir nArms reps
  const [dir, nArms, reps] = a; const s = rd(path.join(dir, 'summary.json'));
  const out = (m) => { console.log(m); process.exit(0); };
  if (!s) out('no-summary');
  if (s.interrupted) out('interrupted:' + s.interrupted);
  if (!s.isolationGate || s.isolationGate.ok !== true) out('isolation-gate-not-ok');
  if ((s.armIds || []).length !== +nArms || s.replicates !== +reps || (s.taskIds || []).length !== 1) out('config-mismatch');
  const exp = s.armIds.length * s.replicates;
  if (!Array.isArray(s.results) || s.results.length !== exp) out('runs:' + (s.results || []).length + '/' + exp);
  if (s.results.some((r) => r.status === 'budget_skipped')) out('budget-skipped');
  out('complete');
} else if (cmd === 'labels') {       // dir -> sorted unique arm labels
  const s = rd(path.join(a[0], 'summary.json')); if (!s) process.exit(1);
  console.log([...new Set(s.results.map((r) => r.armLabel))].sort().join(','));
} else if (cmd === 'stats') {        // dir -> counts and censored/null-credit info
  const s = rd(path.join(a[0], 'summary.json')); if (!s) { console.log('-'); process.exit(0); }
  const nullCr = s.results.filter((r) => r.credits == null && !r.creditsCensored).length;
  const cens = s.results.filter((r) => r.creditsCensored).length;
  const infra = s.results.filter((r) => r.infraError).length;
  console.log(JSON.stringify(s.counts) + ' nullCredits=' + nullCr + ' censored=' + cens + ' infra=' + infra);
} else if (cmd === 'dur') {          // dir -> seconds startedAt..finishedAt
  const s = rd(path.join(a[0], 'summary.json')); if (!s) process.exit(1);
  console.log(Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 1000));
} else if (cmd === 'credits') {      // dirs... -> "total runs nullCredits"
  let tot = 0, runs = 0, nul = 0;
  for (const d of a) for (const e of ledger(d)) {
    if (e.kind !== 'run') continue;
    runs++; if (e.credits == null && !e.censored) nul++;
    tot += Number(e.charged ?? e.credits ?? 0) || 0;
  }
  console.log(tot.toFixed(2) + ' ' + runs + ' ' + nul);
} else if (cmd === 'started') {      // dir -> epoch seconds of run-config startedAt
  const c = rd(path.join(a[0], 'run-config.json')); if (!c) process.exit(1);
  console.log(Math.round(Date.parse(c.startedAt) / 1000));
} else if (cmd === 'smoke') {        // dir kind -> pass/fail lines for the smoke checks
  const [dir, kind] = a; const s = rd(path.join(dir, 'summary.json')); const fails = [];
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
  if (!s) { console.log('FAIL no summary.json'); process.exit(1); }
  const r = s.results[0] || {};
  ok(s.results.length === 1, 'one run recorded (' + s.results.length + ')');
  ok(!s.interrupted, 'summary not interrupted');
  ok(s.isolationGate && s.isolationGate.ok === true, 'isolation gate ok (installs unchanged)');
  ok(r.agentEngine === process.env.ENGINE && s.agentEngine === process.env.ENGINE, 'engine ' + process.env.ENGINE + ' (' + r.agentEngine + ')');
  ok(r.sessionModel === process.env.MODEL || r.model === process.env.MODEL, 'model pinned ' + process.env.MODEL + ' (session ' + r.sessionModel + ')');
  ok(!r.infraError && !(r.flags || []).includes('modelMismatch'), 'no infra error / model mismatch (status ' + r.status + ', flags ' + JSON.stringify(r.flags) + ')');
  ok(typeof r.credits === 'number' && r.credits > 0, 'credits captured: ' + r.credits + ' (censored ' + r.creditsCensored + ')');
  const led = ledger(dir).filter((e) => e.kind === 'run');
  ok(led.length === 1 && typeof led[0].credits === 'number', 'ledger line has credits: ' + JSON.stringify(led[0] && led[0].credits));
  ok(r.wallClockMs > 0, 'wall clock ' + r.wallClockMs + ' ms');
  ok(Object.hasOwn(r, 'skillsLoaded') && Object.hasOwn(r, 'orch') && Object.hasOwn(r, 'sopsLoaded') && Object.hasOwn(r, 'capInvocation'), 'skill/orch metric fields present (skillsLoaded=' + JSON.stringify(r.skillsLoaded) + ', orch=' + (r.orch ? 'record' : r.orch) + ')');
  if (kind === 'real') {
    ok(r.hiddenTests && r.hiddenTests.total > 0, 'target (FAIL_TO_PASS) tests ran: ' + JSON.stringify(r.hiddenTests));
    ok(r.regressionTests && r.regressionTests.total > 0, 'regression (PASS_TO_PASS) tests ran: ' + JSON.stringify(r.regressionTests));
    ok(r.contamination && Object.hasOwn(r.contamination, 'externalFetch') && Object.hasOwn(r.contamination, 'fixRecallChars'), 'contamination check ran: ' + JSON.stringify(r.contamination));
    ok(Array.isArray(r.checks) && r.checks.length > 0, 'checks recorded: ' + (r.checks || []).map((c) => c.type + ':' + (c.ok ?? c.passed)).join(','));
    const rc = rd(path.join(dir, 'run-config.json')); ok(rc && rc.real && rc.real.cache, 'real cache used offline: ' + (rc && rc.real && rc.real.cache));
  }
  if (kind === 'auton' || kind === 'probe') {
    ok(Object.hasOwn(r, 'turns') && Object.hasOwn(r, 'interjections') && Object.hasOwn(r, 'questions'), 'autonomy fields present');
  }
  if (kind === 'probe') {
    ok(r.turns === 2 && r.interjections === 1, 'resume exercised: turns=' + r.turns + ' interjections=' + r.interjections + ' sessionId=' + r.sessionId);
    ok(Array.isArray(r.checks) && r.checks.length > 0 && r.checks.every((c) => c.passed === true), 'resumed turn kept context (hello.txt check passed)');
    const sid = new Set(); for (const n of [1, 2]) { try { for (const l of fs.readFileSync(path.join(dir, r.armId || 'vanilla', r.taskId, '1', 'stream-' + n + '.jsonl'), 'utf8').split('\n')) { const m = l.match(/"sessionId":"(sess_[^"]+)"/); if (m) sid.add(m[1]); } } catch {} }
    ok(sid.size === 1, 'same session id on both turns (' + [...sid].join(',') + ')');
  }
  console.log('RESULT ' + JSON.stringify({ status: r.status, credits: r.credits, wallClockMs: r.wallClockMs, hiddenTests: r.hiddenTests, regressionTests: r.regressionTests, askedUser: r.askedUser, turns: r.turns, interjections: r.interjections, questionsAsked: r.questionsAsked, unmatchedQuestions: r.unmatchedQuestions, autonomous: r.autonomous, completedWithoutHelp: r.completedWithoutHelp, intendedTests: r.intendedTests, invariantTests: r.invariantTests, contamination: r.contamination, flags: r.flags }));
  process.exit(fails.length ? 1 : 0);
}
JS
)
hj() { ENGINE="$ENGINE" MODEL="$MODEL" node -e "$HELPER_JS" "$@"; }

# ---------------------------------------------------------------- small utilities
fmt_dur() { # seconds -> 1h23m
  local s=${1:-0}; [ "$s" -lt 0 ] && s=0
  printf '%dh%02dm' $((s / 3600)) $(((s % 3600) / 60))
}
free_gb() { df -Pk "$1" | awk 'NR==2{printf "%d", $4/1048576}'; }
mem_avail_gb() { awk '/MemAvailable/{printf "%d", $2/1048576}' /proc/meminfo; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
daemon_pid() {
  local p; p=$(cat "$PIDFILE" 2>/dev/null) || return 1
  alive "$p" && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q 'run-real-pilot' && { echo "$p"; return 0; }
  return 1
}
other_bench_running() { # prints matching command lines; excludes this script's own descendants
  pgrep -af "$BENCH_PROC_PATTERN" | grep -v "^$$ " || true
}
sha_is() { [ -n "$1" ] && [ -n "$2" ] && { [[ $1 == "$2"* ]] || [[ $2 == "$1"* ]]; }; }
has_arm() { [[ ",$ARMS," == *",$1,"* || ",$ARMS," == *",$1="* ]]; }
orch_sha() { [ -n "$ORCH_DIR" ] && git -C "$ORCH_DIR" rev-parse --short=8 HEAD 2>/dev/null || true; }
main_sha() { git -C "$REPO" rev-parse --short=7 origin/main 2>/dev/null || true; }

# ---------------------------------------------------------------- preflight
PF_FAIL=0
pf() { # ok|FAIL message
  if [ "$1" = ok ]; then say "preflight ok:   $2"; else say "preflight FAIL: $2"; PF_FAIL=1; fi
}
preflight() {
  PF_FAIL=0
  local br head wtsha wtclean orig free fstype mem running dp d
  br=$(git -C "$REPO" branch --show-current)
  if [ -z "$EXPECT_BRANCH" ]; then pf ok "branch ${br:-detached} (EXPECT_BRANCH unset, not pinned)"
  elif [ "$br" = "$EXPECT_BRANCH" ]; then pf ok "branch $br"
  else pf FAIL "branch is '$br', expected $EXPECT_BRANCH"; fi
  head=$(git -C "$REPO" rev-parse --short=8 HEAD); say "repo HEAD $head (recorded; bench/ must stay unchanged)"
  git -C "$REPO" diff --quiet HEAD -- bench && git -C "$REPO" diff --cached --quiet -- bench && pf ok "bench/ has no uncommitted changes" || pf FAIL "bench/ has uncommitted changes"
  if [ -n "$ORCH_DIR" ]; then
    wtsha=$(orch_sha)
    if [ -z "$wtsha" ]; then pf FAIL "ORCH_DIR $ORCH_DIR is not a git checkout"
    elif [ -z "$EXPECT_ORCH_SHA" ]; then pf ok "ORCH_DIR HEAD $wtsha (EXPECT_ORCH_SHA unset, pinned at launch)"
    elif sha_is "$wtsha" "$EXPECT_ORCH_SHA"; then pf ok "ORCH_DIR HEAD $wtsha"
    else pf FAIL "ORCH_DIR HEAD is '$wtsha', expected $EXPECT_ORCH_SHA"; fi
    wtclean=$(git -C "$ORCH_DIR" status --porcelain --untracked-files=all 2>/dev/null | head -1)
    [ -z "$wtclean" ] && pf ok "ORCH_DIR is clean" || pf FAIL "ORCH_DIR is dirty: $wtclean"
  fi
  orig=$(main_sha)
  if [ -z "$orig" ]; then
    if has_arm main; then pf FAIL "origin/main does not resolve in $REPO but the main arm is used"; else pf ok "no origin/main needed"; fi
  elif [ -z "$EXPECT_MAIN_SHA" ]; then pf ok "origin/main $orig (EXPECT_MAIN_SHA unset, pinned at launch)"
  elif sha_is "$orig" "$EXPECT_MAIN_SHA"; then pf ok "origin/main $orig"
  else pf FAIL "origin/main is '$orig', expected $EXPECT_MAIN_SHA"; fi
  if [ "${NO_KIRO_CHECK:-0}" != 1 ]; then
    if "$KIRO" whoami >/dev/null 2>&1; then pf ok "kiro-cli logged in"; else pf FAIL "kiro-cli is not logged in ($KIRO whoami failed)"; fi
    [ -r "$AUTH_DB" ] && pf ok "auth database $AUTH_DB" || pf FAIL "auth database missing: $AUTH_DB"
  fi
  for d in $ARM_CACHES; do
    [ -d "$d" ] && pf ok "arm cache $(basename "$d")" || pf FAIL "arm cache missing: $d (run --preflight to build)"
  done
  [ -d "$CARGO_TARGET" ] && pf ok "cargo target $CARGO_TARGET" || pf FAIL "cargo target missing: $CARGO_TARGET (create it or set CARGO_TARGET)"
  [ "${#TASKS[@]}" -gt 0 ] && pf ok "${#TASKS[@]} tasks in $TASKS_FILE" || pf FAIL "no tasks: $TASKS_FILE is missing or empty"
  local t suite task miss=0
  for t in "${TASKS[@]}"; do
    IFS='|' read -r suite task _ kind _ <<<"$t"
    [ "$kind" = real ] || continue
    [ -d "$REAL_CACHE/${task#real-}" ] || { miss=1; pf FAIL "real-repo cache missing for $task (node bench/real/fetch.js --cache $REAL_CACHE)"; }
  done
  [ "$miss" = 0 ] && pf ok "real-repo cache $REAL_CACHE has all real tasks"
  mkdir -p "$RESULTS"
  free=$(free_gb "$RESULTS"); fstype=$(stat -f -c %T "$RESULTS"); mem=$(mem_avail_gb)
  if [ "$fstype" = tmpfs ]; then
    [ "$free" -ge "$MIN_FREE_GB_TMPFS" ] && [ "$mem" -ge "$MIN_MEM_GB" ] && pf ok "results fs is tmpfs: ${free} GB free (needs ${MIN_FREE_GB_TMPFS}), ${mem} GB RAM available (needs ${MIN_MEM_GB})" \
      || pf FAIL "results fs is tmpfs: ${free} GB free (needs ${MIN_FREE_GB_TMPFS}), ${mem} GB RAM available (needs ${MIN_MEM_GB})"
    [ "$free" -ge "$MIN_FREE_GB" ] || say "note: tmpfs has ${free} GB free, under the ${MIN_FREE_GB} GB default for disk-backed storage"
  else
    [ "$free" -ge "$MIN_FREE_GB" ] && pf ok "${free} GB free on results fs (needs ${MIN_FREE_GB})" || pf FAIL "${free} GB free on results fs (needs ${MIN_FREE_GB})"
  fi
  running=$(other_bench_running)
  [ -z "$running" ] && pf ok "no other bench run active" || pf FAIL "another bench run is active: $running"
  pgrep -af 'konductor[^ ]* (install|update)' | grep -v pgrep >/dev/null && pf FAIL "a konductor install/update is running" || pf ok "no konductor install/update running"
  if dp=$(daemon_pid) && [ "${RP_CHILD:-0}" != 1 ]; then pf FAIL "run-real-pilot is already running (pid $dp)"; else pf ok "no other run-real-pilot daemon"; fi
  node --version >/dev/null 2>&1 && pf ok "node $(node --version)" || pf FAIL "node not found"
  if [ "${NO_ISOLATION_CHECK:-0}" != 1 ]; then
    command -v unshare >/dev/null && command -v setpriv >/dev/null && pf ok "unshare and setpriv present" || pf FAIL "unshare or setpriv missing"
  fi
  case "$SCRATCH_PARENT" in *[Bb][Ee][Nn][Cc][Hh]*) pf FAIL "SCRATCH_PARENT '$SCRATCH_PARENT' contains the word bench" ;; *) pf ok "scratch parent $SCRATCH_PARENT" ;; esac
  return "$PF_FAIL"
}

# ---------------------------------------------------------------- scratch HOME/TMPDIR around every bench.js call
CUR_SH=""; CUR_TD=""; CHILD_PIDFILE=""; STOPPING=0
cleanup_scratch() {
  local d
  for d in "$CUR_SH" "$CUR_TD"; do
    case "$d" in "$SCRATCH_PARENT"/xq-home.*|"$SCRATCH_PARENT"/xq.*) rm -rf -- "$d" ;; esac
  done
  case "$CHILD_PIDFILE" in "$SCRATCH_PARENT"/xq-child.*) rm -f -- "$CHILD_PIDFILE" ;; esac
  CUR_SH=""; CUR_TD=""; CHILD_PIDFILE=""
}
on_term() {
  STOPPING=1
  say "signal received: stopping the runner (it flushes summary.json as interrupted)"
  if [ -n "$CHILD_PIDFILE" ] && [ -s "$CHILD_PIDFILE" ]; then kill -TERM "$(cat "$CHILD_PIDFILE")" 2>/dev/null; fi
}
trap on_term TERM INT HUP
trap cleanup_scratch EXIT

# run_bench <tasklog> <timeout-sec> <bench.js args...>; returns the runner's exit code
run_bench() {
  local tasklog=$1 limit=$2; shift 2
  CUR_SH=$(mktemp -d "$SCRATCH_PARENT/xq-home.XXXXXX") || return 99
  CUR_TD=$(mktemp -d "$SCRATCH_PARENT/xq.XXXXXX") || { cleanup_scratch; return 99; }
  CHILD_PIDFILE=$(mktemp "$SCRATCH_PARENT/xq-child.XXXXXX") || { cleanup_scratch; return 99; }
  mkdir -p "$(dirname "$tasklog")"
  (
    (
      echo "$BASHPID" > "$CHILD_PIDFILE"
      cd "$REPO" || exit 98
      exec env HOME="$CUR_SH" TMPDIR="$CUR_TD" CARGO_HOME="$REAL_HOME/.cargo" RUSTUP_HOME="$REAL_HOME/.rustup" \
        timeout -s TERM -k 300 "$limit" node "$CLI_JS" "$@"
    ) < /dev/null 2>&1 | tee -a "$tasklog"
    exit "${PIPESTATUS[0]}"
  ) &
  local pid=$! rc
  wait "$pid"; rc=$?
  while kill -0 "$pid" 2>/dev/null; do wait "$pid"; rc=$?; done
  cleanup_scratch
  return "$rc"
}

# common run flags (after `run --suite S --tasks T --arms A`)
common_flags() {
  printf '%s\0' --agent-engine "$ENGINE" --model "$MODEL" --seed "$SEED" --cache "$CACHE" --cargo-target "$CARGO_TARGET" \
    --auth-db "$AUTH_DB" --parallel 1
}

# ---------------------------------------------------------------- plan helpers
autonomy_supported() {
  case "${AUTONOMY:-auto}" in 1) return 0 ;; 0) return 1 ;; esac
  [ -s "$AUTONOMY_MARKER" ] && head -1 "$AUTONOMY_MARKER" | grep -q '^supported'
}
active_tasks() { # prints the task lines that will run
  local t kind
  for t in "${TASKS[@]}"; do
    IFS='|' read -r _ _ _ kind _ <<<"$t"
    if [ "$kind" = auton ] && ! autonomy_supported; then continue; fi
    echo "$t"
  done
}
skipped_auton() { # prints the autonomy task ids that will be skipped
  local t task kind
  for t in "${TASKS[@]}"; do
    IFS='|' read -r _ task _ kind _ <<<"$t"
    if [ "$kind" = auton ] && ! autonomy_supported; then printf ' %s' "$task"; fi
  done
}
prepare_args() { # bench.js arguments of the free arm-set preparation, which uses the first task in the list
  local suite task
  IFS='|' read -r suite task _ <<<"${TASKS[0]}"
  printf '%s\0' run --suite "$suite" --tasks "$task" --arms "$ARMS" --agent-engine "$ENGINE" --model "$MODEL" \
    --profile detailed --seed "$SEED" --cache "$CACHE" --cargo-target "$CARGO_TARGET" --auth-db "$AUTH_DB" --prepare-only --out "$1"
}
est_total_sec() { local t s=0 e; while read -r t; do IFS='|' read -r _ _ _ _ e <<<"$t"; s=$((s + e)); done < <(active_tasks); echo "$s"; }
banner() {
  local n est sk; n=$(active_tasks | wc -l); est=$(est_total_sec); sk=$(skipped_auton)
  say "STUDY: tasks from $TASKS_FILE, Kiro $ENGINE, $MODEL, profile detailed ($REPS replicates + A/A), seed $SEED, parallel 1"
  say "ARMS : $ARMS (+ A/A repeat of the first konductor arm)"
  say "TASKS: $n task dirs x $EXPECT_RUNS runs = $((n * EXPECT_RUNS)) runs; estimated $(fmt_dur "$est") wall clock"
  say "COST : NO credit cap set (no --budget-credits). Running total is logged after each task dir."
  if [ -n "$sk" ]; then say "SKIPPED (autonomy tier unsupported on engine $ENGINE):$sk"; fi
}

task_cmd() { # prints the bench.js arguments for one task (NUL-free, space separated, for display)
  local suite=$1 task=$2 kind=$3 out=$4
  local -a f=(run --suite "$suite" --tasks "$task" --arms "$ARMS" --profile detailed)
  mapfile -d '' -t c < <(common_flags)
  f+=("${c[@]}")
  [ "$kind" = real ] && f+=(--real-cache "$REAL_CACHE")
  f+=(--out "$out")
  printf '%q ' "${f[@]}"
}

# ---------------------------------------------------------------- status
do_status() {
  local V dp tot done_n=0 t suite task name state creds runs nul
  [ -s "$STUDYFILE" ] || { echo "no study yet ($STUDYFILE missing)"; exit 0; }
  V=$(cat "$STUDYFILE")
  if dp=$(daemon_pid); then echo "daemon: running, pid $dp"; else echo "daemon: not running"; fi
  echo "study dir: $V"; echo "log: $LOG"
  local -a dirs=() lines=()
  local cur="" avgsum=0 avgn=0 remaining=0 prior=0 cur_el=0
  while read -r t; do
    IFS='|' read -r suite task _ _ est <<<"$t"
    name="$suite-$task"
    state=$(hj complete "$V/$name" "$N_ARMS" "$REPS" 2>/dev/null || echo "-")
    [ -d "$V/$name" ] || state="not-started"
    if [ "$state" = complete ]; then
      done_n=$((done_n + 1)); dirs+=("$V/$name")
      d=$(hj dur "$V/$name" 2>/dev/null) && { avgsum=$((avgsum + d)); avgn=$((avgn + 1)); }
      lines+=("  [done] $name  $(hj stats "$V/$name")")
    elif [ "$state" = not-started ]; then
      remaining=$((remaining + 1)); prior=$((prior + est)); lines+=("  [todo] $name")
    else
      dirs+=("$V/$name"); cur=$name
      n=$(find "$V/$name" -mindepth 4 -maxdepth 4 -name result.json 2>/dev/null | wc -l)
      st=$(hj started "$V/$name" 2>/dev/null || echo 0); [ "$st" -gt 0 ] && cur_el=$(($(date +%s) - st))
      prior=$((prior + est)); lines+=("  [run ] $name  $n/$EXPECT_RUNS runs, $(fmt_dur "$cur_el") elapsed ($state)")
    fi
  done < <(active_tasks)
  tot=$(active_tasks | wc -l)
  echo "tasks done: $done_n/$tot"
  printf '%s\n' "${lines[@]}"
  [ -n "$(skipped_auton)" ] && echo "skipped (autonomy tier unsupported on engine $ENGINE):$(skipped_auton)"
  # shellcheck disable=SC2046
  read -r creds runs nul < <(hj credits "$V"/*/ 2>/dev/null || echo "0 0 0")
  echo "runs logged: ${runs:-0}  credits so far: ${creds:-0}  (runs with null credits: ${nul:-0})"
  local eta avg
  if [ "$avgn" -gt 0 ]; then avg=$((avgsum / avgn)); else avg=0; fi
  if [ "$avg" -gt 0 ]; then
    eta=$((remaining * avg)); [ -n "$cur" ] && eta=$((eta + (avg > cur_el ? avg - cur_el : 0)))
    echo "ETA: $(fmt_dur "$eta") (observed mean $(fmt_dur "$avg") per completed task dir x remaining)"
  else
    eta=$prior; [ -n "$cur" ] && eta=$((eta > cur_el ? eta - cur_el : 0))
    echo "ETA: about $(fmt_dur "$eta") (no completed task yet; prior estimate per task)"
  fi
  echo "last 10 log lines:"; tail -n 10 "$LOG" 2>/dev/null | sed 's/^/  /'
}

# ---------------------------------------------------------------- the main loop
check_stable() { # between tasks: nothing the study depends on has moved
  local want_head=$1 want_orch=$2 want_main=$3 head
  head=$(git -C "$REPO" rev-parse --short=8 HEAD)
  [ "$head" = "$want_head" ] || { say "repo HEAD moved: $head (started at $want_head)"; return 1; }
  git -C "$REPO" diff --quiet HEAD -- bench || { say "bench/ was modified"; return 1; }
  if [ -n "$want_main" ]; then sha_is "$(main_sha)" "$want_main" || { say "origin/main moved"; return 1; }; fi
  if [ -n "$ORCH_DIR" ]; then
    sha_is "$(orch_sha)" "$want_orch" || { say "ORCH_DIR HEAD moved"; return 1; }
    [ -z "$(git -C "$ORCH_DIR" status --porcelain --untracked-files=all | head -1)" ] || { say "ORCH_DIR is dirty"; return 1; }
  fi
  [ "$(free_gb "$RESULTS")" -ge "$ABORT_FREE_GB" ] || { say "results filesystem under ${ABORT_FREE_GB} GB free"; return 1; }
  if [ "${NO_KIRO_CHECK:-0}" != 1 ]; then "$KIRO" whoami >/dev/null 2>&1 || { say "kiro-cli is no longer logged in"; return 1; }; fi
  return 0
}

report_prejudge() {
  local V=$1; shift
  local joined; joined=$(IFS=,; echo "$*")
  local out=$V/reports-prejudge
  mkdir -p "$out"
  say "pass-prejudge reports over $# task dirs (no model call, no judging) -> $out"
  run_bench "$V/logs/report-orchestrator-pass.log" 1800 report --run "$joined" --verdict orchestrator-pass --baseline vanilla --out "$out/orchestrator-pass" \
    || say "WARNING: orchestrator-pass report failed (see $V/logs/report-orchestrator-pass.log)"
  run_bench "$V/logs/report-platform.log" 1800 report --run "$joined" --verdict platform --baseline vanilla --out "$out/platform" \
    || say "WARNING: platform report failed (see $V/logs/report-platform.log)"
}

main_loop() {
  local V=$1 start_head=$2 want_orch=$3 want_main=$4 failed="" done_dirs=() t suite task tmo kind est name dir st rc labels ref_labels creds runs nul total_n=0 i=0
  mkdir -p "$V/logs" "$V/incomplete"
  ref_labels=$(cat "$V/arm-labels.txt" 2>/dev/null || true)
  total_n=$(active_tasks | wc -l)
  while read -r t; do
    i=$((i + 1))
    IFS='|' read -r suite task tmo kind est <<<"$t"
    name="$suite-$task"; dir=$V/$name
    [ "$STOPPING" = 1 ] && break
    st=$(hj complete "$dir" "$N_ARMS" "$REPS" 2>/dev/null || echo no-summary)
    if [ -d "$dir" ] && [ "$st" = complete ]; then
      say "[$i/$total_n] $name: already complete, skipping"
      done_dirs+=("$dir"); continue
    fi
    if [ -e "$dir" ]; then
      local dest; dest="$V/incomplete/$name-$(date -u +%Y%m%dT%H%M%SZ)"
      say "[$i/$total_n] $name: found incomplete dir ($st); moving to $dest"
      mv -- "$dir" "$dest" || { failed="$failed $name(move-failed)"; break; }
    fi
    check_stable "$start_head" "$want_orch" "$want_main" || { say "stopping before $name: environment changed"; failed="$failed $name(env-changed)"; break; }
    say "[$i/$total_n] $name: START ($EXPECT_RUNS runs, timeout ${tmo}s per run, est $(fmt_dur "$est"))"
    local -a args=(run --suite "$suite" --tasks "$task" --arms "$ARMS" --profile detailed)
    mapfile -d '' -t c < <(common_flags); args+=("${c[@]}")
    [ "$kind" = real ] && args+=(--real-cache "$REAL_CACHE")
    args+=(--out "$dir")
    run_bench "$V/logs/$name.run.log" $((EXPECT_RUNS * tmo + 3600)) "${args[@]}"; rc=$?
    st=$(hj complete "$dir" "$N_ARMS" "$REPS" 2>/dev/null || echo no-summary)
    read -r creds runs nul < <(hj credits "$V"/*/ 2>/dev/null || echo "0 0 0")
    say "[$i/$total_n] $name: runner exit $rc, dir state: $st, $(hj stats "$dir" 2>/dev/null)"
    say "credits: study total ${creds} over ${runs} runs (no cap set); runs with null credits so far: ${nul}"
    if [ "$rc" = 4 ] || grep -q 'ISOLATION FAILURE' "$V/logs/$name.run.log" 2>/dev/null; then
      say "ISOLATION FAILURE in $name: the installs gate saw a change in the real ~/.konductor/installs. Stopping the study."
      failed="$failed $name(ISOLATION)"; break
    fi
    if [ "$STOPPING" = 1 ]; then failed="$failed $name(stopped)"; break; fi
    if [ "$rc" != 0 ] || [ "$st" != complete ]; then
      say "WARNING: $name did not finish cleanly (exit $rc, $st); it is left in place and will be moved to incomplete/ on the next run"
      failed="$failed $name"; continue
    fi
    labels=$(hj labels "$dir")
    if [ -z "$ref_labels" ]; then ref_labels=$labels; echo "$labels" > "$V/arm-labels.txt"; say "arm labels for pooling: $labels"; fi
    if [ "$labels" != "$ref_labels" ]; then
      say "ERROR: arm labels of $name differ from the first task dir ($labels vs $ref_labels); pooling by exact ref would split. Stopping."
      failed="$failed $name(labels)"; break
    fi
    done_dirs+=("$dir")
  done < <(active_tasks)

  if [ -z "$failed" ] && [ "${#done_dirs[@]}" -eq "$total_n" ]; then
    report_prejudge "$V" "${done_dirs[@]}"
    say "DONE: $total_n/$total_n task dirs complete in $V. Pooled report command: node bench/runner/bench.js report --run <dirs> ... ; judging is a separate step (needs credentials)."
    return 0
  fi
  say "FAILED: ${#done_dirs[@]}/$total_n task dirs complete; problems:${failed:- none recorded}. Rerun $SCRIPT to resume."
  [ "${#done_dirs[@]}" -gt 0 ] && report_prejudge "$V" "${done_dirs[@]}"
  return 1
}

# ---------------------------------------------------------------- smoke test (SMOKE=1)
first_of_kind() { # <kind> -> "suite|task" of the first task of that kind in TASKS_FILE
  local t suite task k
  for t in "${TASKS[@]}"; do
    IFS='|' read -r suite task _ k _ <<<"$t"
    [ "$k" = "$1" ] && { printf '%s|%s' "$suite" "$task"; return 0; }
  done
  return 1
}
smoke_one() { # <name> <kind> <suite> <task> <extra bench.js args...>: one vanilla run, then the checks
  local name=$1 kind=$2 suite=$3 task=$4 rc; shift 4
  run_bench "$S/logs/$name.run.log" 1800 run --suite "$suite" --tasks "$task" --arms vanilla --profile quick --replicates 1 \
    "${c[@]}" "$@" --out "$S/$name"; rc=$?
  say "runner exit $rc"
  hj smoke "$S/$name" "$kind" | tee -a "$S/smoke-verify.txt"
}
run_smoke() {
  local fail=0 sel suite task
  S=$RESULTS/real-pilot-smoke-$(date -u +%Y%m%dT%H%M%SZ)
  mkdir -p "$S/logs"; say "SMOKE test dir: $S (not the study dir)"
  mapfile -d '' -t c < <(common_flags)
  if sel=$(first_of_kind real); then
    IFS='|' read -r suite task <<<"$sel"; task=${SMOKE_REAL_TASK:-$task}
    say "smoke 1/3: real task $task, vanilla, 1 replicate"
    smoke_one real real "$suite" "$task" --real-cache "$REAL_CACHE" || fail=1
  else say "smoke 1/3: skipped, no real task in $TASKS_FILE"; fi
  if [ -n "${PROBE_BENCH:-}" ]; then
    # The probe prompt ends on the question: the asked-user heuristic only reads a final paragraph that ends in "?".
    say "smoke 2/3: autonomy resume probe on engine $ENGINE (two-turn task from $PROBE_BENCH), vanilla, 1 replicate"
    if smoke_one probe probe "${PROBE_SUITE:-autonomy}" "${PROBE_TASK:-probe-hello}" --bench-dir "$PROBE_BENCH"; then
      echo "supported: scripted user + --resume-id verified on engine $ENGINE by $S/probe ($(ts))" > "$AUTONOMY_MARKER"; say "autonomy tier on $ENGINE: SUPPORTED (marker $AUTONOMY_MARKER)"
    else
      fail=1; echo "unsupported: resume probe failed, see $S/smoke-verify.txt ($(ts))" > "$AUTONOMY_MARKER"; say "autonomy tier on $ENGINE: NOT supported (marker written)"
    fi
  else say "smoke 2/3: skipped, PROBE_BENCH is not set (the autonomy marker is left as it is; AUTONOMY=1 forces the tier on)"; fi
  if sel=$(first_of_kind auton); then
    IFS='|' read -r suite task <<<"$sel"; task=${SMOKE_AUTON_TASK:-$task}
    say "smoke 3/3: autonomy task $task, vanilla, 1 replicate"
    smoke_one auton auton "$suite" "$task" || fail=1
  else say "smoke 3/3: skipped, no auton task in $TASKS_FILE"; fi
  say "SMOKE finished: $([ "$fail" = 0 ] && echo PASS || echo 'FAIL (see FAIL lines above)'); output in $S"
  return "$fail"
}

# ---------------------------------------------------------------- entry points
case "$MODE" in
  status) do_status; exit 0 ;;
  stop)
    if dp=$(daemon_pid); then kill -TERM "$dp" && echo "sent SIGTERM to $dp; watch: tail -f $LOG"; else echo "not running"; fi
    exit 0 ;;
esac

if [ "$SMOKE" = 1 ]; then
  say "SMOKE=1: cheap smoke test, no study dir"
  preflight || die "preflight failed (see lines above)"
  run_smoke; exit $?
fi

if [ "${RP_CHILD:-0}" != 1 ]; then
  banner
  preflight || die "preflight failed (see lines above); nothing launched"
fi

if [ "$MODE" = dry-run ]; then
  say "DRY RUN: no builds, no model calls. Preflight result above."
  V=$( [ -s "$STUDYFILE" ] && cat "$STUDYFILE" || echo "$RESULTS/real-pilot-<UTC timestamp>" )
  say "study dir would be: $V"
  i=0; while read -r t; do
    i=$((i + 1)); IFS='|' read -r suite task tmo kind est <<<"$t"
    printf '  %2d. %s-%s  runs=%d timeout=%ss est=%s\n      env HOME=$(mktemp -d) TMPDIR=$(mktemp -d %s/xq.XXXXXX) timeout %ss node %s %s\n' \
      "$i" "$suite" "$task" "$EXPECT_RUNS" "$tmo" "$(fmt_dur "$est")" "$SCRATCH_PARENT" $((EXPECT_RUNS * tmo + 3600)) "${CLI_JS#"$REPO"/}" "$(task_cmd "$suite" "$task" "$kind" "$V/$suite-$task")"
  done < <(active_tasks)
  say "final step: report --run <all complete task dirs> --verdict orchestrator-pass and --verdict platform -> $V/reports-prejudge/"
  exit 0
fi

if [ "$MODE" = preflight ]; then
  say "prepare-only for the arm set (free: builds and trial-installs every arm, starts no agent)"
  [ "${#TASKS[@]}" -gt 0 ] || die "no tasks in $TASKS_FILE"
  mapfile -d '' -t PREP < <(prepare_args "$BASE/real-pilot-work/prepare-only-unused")
  run_bench "$BASE/real-pilot-work/prepare-only.log" 3000 "${PREP[@]}"
  rc=$?; say "prepare-only exit $rc (log $BASE/real-pilot-work/prepare-only.log)"; exit "$rc"
fi

# real run: study dir, prepare-only gate, daemonize
if [ "${RP_CHILD:-0}" != 1 ]; then
  RP_HEAD=$(git -C "$REPO" rev-parse --short=8 HEAD)
  RP_ORCH=${EXPECT_ORCH_SHA:-$(orch_sha)}
  RP_MAIN=${EXPECT_MAIN_SHA:-$(main_sha)}
  if [ -s "$STUDYFILE" ] && [ -d "$(cat "$STUDYFILE")" ]; then
    V=$(cat "$STUDYFILE"); say "resuming study $V"
  else
    V=$RESULTS/real-pilot-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$V"; echo "$V" > "$STUDYFILE"; say "new study $V"
  fi
  mkdir -p "$V/logs"
  say "prepare-only for the arm set (free)"
  mkdir -p "$BASE/real-pilot-work"
  mapfile -d '' -t PREP < <(prepare_args "$V/prepare-only-unused")
  run_bench "$V/logs/prepare-only.log" 3000 "${PREP[@]}"
  rc=$?; [ "$rc" = 0 ] || die "prepare-only failed (exit $rc, $V/logs/prepare-only.log); nothing launched"
  grep -E '^(arm |vanilla|orch-all|main-unreleased|prepare-only)' "$V/logs/prepare-only.log" | sed 's/^/    /'
  # study record
  { echo "started: $(ts)"; echo "script: $SCRIPT"; echo "repo HEAD: $(git -C "$REPO" rev-parse HEAD)"; echo "ORCH_DIR HEAD: ${ORCH_DIR:+$(git -C "$ORCH_DIR" rev-parse HEAD)}"
    echo "origin/main: $(git -C "$REPO" rev-parse origin/main 2>/dev/null)"; echo "kiro-cli: $("$KIRO" --version 2>&1)"; echo "arms: $ARMS (+ A/A repeat of the first konductor arm)"; echo "engine/model/seed: $ENGINE $MODEL $SEED"
    echo "autonomy tier: $(autonomy_supported && echo included || echo "SKIPPED (unsupported on engine $ENGINE or not proven by smoke)")"; } >> "$V/study.txt"
  if [ "$MODE" = daemon ]; then
    rm -f "$PIDFILE"
    RP_CHILD=1 RP_V="$V" RP_HEAD="$RP_HEAD" RP_ORCH="$RP_ORCH" RP_MAIN="$RP_MAIN" setsid nohup bash "$SCRIPT" --foreground >> "$LOG" 2>&1 < /dev/null &
    for _ in $(seq 1 20); do [ -s "$PIDFILE" ] && break; sleep 0.5; done
    dp=$(daemon_pid) || die "daemon did not start; see $LOG"
    say "LAUNCHED: pid $dp, study $V"
    say "log:    tail -f $LOG"
    say "status: bash $SCRIPT --status"
    say "stop:   bash $SCRIPT --stop     (resume later: rerun this script)"
    exit 0
  fi
  RP_V=$V
fi

# daemon / foreground body
echo $$ > "$PIDFILE"
V=$RP_V
say "run-real-pilot started, pid $$, study $V"
banner
final=0
main_loop "$V" "$RP_HEAD" "$RP_ORCH" "$RP_MAIN" || final=1
cleanup_scratch
rm -f -- "$PIDFILE"
exit "$final"
