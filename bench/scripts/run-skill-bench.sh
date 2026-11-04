#!/usr/bin/env bash
# run-skill-bench.sh - the per-skill benchmark in one command: delete, prune or keep, skill by skill.
#
# WHAT IT DOES
#   Plans a study over the skills at BASE_REF, then runs it one skill at a time and writes a decision per skill:
#   DELETE, PRUNE (with the SKILL.md line ranges to remove or move to references/, and a unified diff), KEEP or NEEDS DATA.
#   Nothing is applied to the repository. Order: known-answer controls first (a failed control stops the study), then for
#   each skill wave 1 (control, A/A repeat, skill deleted), wave 2 (one section removed per arm; only if deleting the skill
#   lost quality) and wave 3 (sections moved to references/; only for sections whose removal lost quality), judging each
#   wave on the opencode backend, and finally `cap decide`.
#
# REQUIRES THE CAPABILITY STUDY TO FINISH FIRST
#   The overall-capability study (real and pilot suites) runs bench.js from this checkout. Do not start this script
#   while it runs: this script refuses when that study's pid file is alive or any bench.js process is running.
#
# USAGE
#   bash run-skill-bench.sh                     preflight, plan if needed, then daemonize (setsid nohup) and return
#   bash run-skill-bench.sh --foreground        run in this terminal
#   bash run-skill-bench.sh --dry-run           preflight (warnings only for credentials), then print the plan, or the waves and
#                                               exact commands of an existing study; builds and runs nothing
#   bash run-skill-bench.sh --preflight         preflight only; exit 0 or 1
#   bash run-skill-bench.sh --status            daemon state, waves done, runs and credits so far, last log lines
#   bash run-skill-bench.sh --stop              SIGTERM the daemon (the runner flushes its summary as interrupted)
#   Options: --tier triage|loaded|large|duplicates|all   (default all)    --skills a,b   only these skills
#            --forced-load low-load|always   add wave 1f, the skill forced to load against it deleted (reported apart, never a call)
#            --forced-held-min X   share of runs each forced arm must load the skill in (above 0, at most 1; default 0.9)
#            --waves 1|all         1 runs the controls and wave 1 only (no forced wave, no waves 2 and 3); default all
#   --forced-load, --forced-held-min and --waves go to every cap skill-study call (init, dry run, run, the daemon child);
#   the plan of a dry run with no study gets --forced-load only, since it estimates every wave.
#   Tiers: loaded = skills that loaded in finished runs; large = named large skills and the biggest; duplicates = near-duplicate
#   pairs; triage = everything else, which gets the free audit only (no lift run: a skill nobody loads cannot show lift).
#
# RESUME: rerun the same command. The study directory is read from STATE_DIR/skill-bench.study. A finished wave is
#   skipped; an unfinished wave is moved to <study>/incomplete/ and rerun. Nothing is deleted.
#
# ENVIRONMENT OVERRIDES (defaults in brackets)
#   REPO        checkout to run from                 [the checkout this script sits in]
#   BASE_REF    git ref the skills are read from     [test/orchestrator-all]
#   STATE_DIR   pid, log and study pointer           [/tmp/konductor-bench]
#   RESULTS     where study directories go           [STATE_DIR/results]
#   CREDS       scoped AWS credentials file for the opencode judge (path only is used; its contents are never read)
#               [unset: a real launch refuses; a dry run warns]
#   CREDS_EXPIRY_UTC  e.g. 2026-11-02T03:13:00Z; a real launch refuses after it [unset]
#   AUTH_DB     kiro-cli auth database               [~/.local/share/kiro-cli/data.sqlite3]
#   OC          opencode binary used by the judge    [opencode on PATH]
#   EXPOSURE_RUNS  comma list of finished run directories used for load data   [none]
#   RUNS_GLOBS  comma list of globs of finished run directories                [none]
#   ARM_CONFIG  per-arm konductor config            [orchestration.mode=coordinator]
#   CACHE       arm build cache, kept across calls     [STATE_DIR/cache]
#   CARGO_TARGET  cargo target dir shared by builds    [STATE_DIR/cargo-target]
#   MODEL, ENGINE, PROFILE, SEED, REPS, TASKS_PER_SKILL, MAX_SECTIONS, BUDGET_USD, WAVE_BUDGET_CREDITS
#   SCREEN      1 (default) shares wave 1 between skills that enter through the same agent: one control and A/A, a delete arm per skill. 0 gives each skill its own wave 1
#   MIN_FREE_GB [20], MIN_FREE_GB_TMPFS [same as MIN_FREE_GB]: free space needed on the results filesystem
#   Test-only: BENCH_PROC_PATTERN, NO_KIRO_CHECK, NO_OPENCODE_CHECK, MIN_FREE_GB, SCRATCH_PARENT, OTHER_PIDFILES, CLI_JS, BENCH_DIR
#
# ISOLATION: do not run konductor install or update, switch branches, or edit bench/ in REPO while this runs. Every
#   bench.js call runs with a scratch HOME and a TMPDIR whose path has no "bench" in it; both are removed afterwards.
#
# EXIT CODES: 0 done, 1 failed or refused, 2 bad usage.

set -u -o pipefail

SELF=$(readlink -f "${BASH_SOURCE[0]}")
DEFAULT_REPO=$(cd "$(dirname "$SELF")/../.." 2>/dev/null && pwd)
REPO=${REPO:-$DEFAULT_REPO}
STATE_DIR=${STATE_DIR:-/tmp/konductor-bench}
RESULTS=${RESULTS:-$STATE_DIR/results}
BENCH_DIR=${BENCH_DIR:-$REPO/bench}
CLI_JS=${CLI_JS:-$REPO/bench/runner/bench.js}
BASE_REF=${BASE_REF:-test/orchestrator-all}
LOG=$STATE_DIR/skill-bench.log
PIDFILE=$STATE_DIR/skill-bench.pid
STUDYFILE=$STATE_DIR/skill-bench.study
OTHER_PIDFILES=${OTHER_PIDFILES:-"real-pilot.pid judging.pid"}
BENCH_PROC_PATTERN=${BENCH_PROC_PATTERN:-'bench/runner/bench\.js'}
CREDS=${CREDS:-${SKILL_BENCH_CREDS:-}}
CREDS_EXPIRY_UTC=${CREDS_EXPIRY_UTC:-}
REAL_HOME=$(getent passwd "$(id -un)" | cut -d: -f6)
AUTH_DB=${AUTH_DB:-$REAL_HOME/.local/share/kiro-cli/data.sqlite3}
OC=${OC:-$(command -v opencode || true)}
EXPOSURE_RUNS=${EXPOSURE_RUNS:-}
RUNS_GLOBS=${RUNS_GLOBS:-}
ARM_CONFIG=${ARM_CONFIG:-orchestration.mode=coordinator}
MODEL=${MODEL:-claude-sonnet-5.5}
ENGINE=${ENGINE:-v3}
PROFILE=${PROFILE:-detailed}
SEED=${SEED:-20261103}
MIN_FREE_GB=${MIN_FREE_GB:-20}
SCRATCH_PARENT=${SCRATCH_PARENT:-/tmp}
BUDGET_USD=${BUDGET_USD:-15}
CACHE=${CACHE:-$STATE_DIR/cache}
CARGO_TARGET=${CARGO_TARGET:-$STATE_DIR/cargo-target}

MODE=daemon
TIER=all
SKILLS=
FORCED_LOAD=
FORCED_HELD_MIN=
WAVES=
while [ $# -gt 0 ]; do
  case "$1" in
    --foreground) MODE=foreground ;;
    --dry-run) MODE=dry-run ;;
    --preflight) MODE=preflight ;;
    --status) MODE=status ;;
    --stop) MODE=stop ;;
    --tier) shift; TIER=${1:-}; [ -n "$TIER" ] || { echo "--tier needs a value" >&2; exit 2; } ;;
    --skills) shift; SKILLS=${1:-}; [ -n "$SKILLS" ] || { echo "--skills needs a value" >&2; exit 2; } ;;
    --forced-load) shift; FORCED_LOAD=${1:-}; [ -n "$FORCED_LOAD" ] || { echo "--forced-load needs a value" >&2; exit 2; } ;;
    --forced-held-min) shift; FORCED_HELD_MIN=${1:-}; [ -n "$FORCED_HELD_MIN" ] || { echo "--forced-held-min needs a value" >&2; exit 2; } ;;
    --waves) shift; WAVES=${1:-}; [ -n "$WAVES" ] || { echo "--waves needs a value" >&2; exit 2; } ;;
    -h|--help) awk 'NR>1 && /^set -u/ {exit} NR>1 {print}' "$SELF"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done
case "$TIER" in triage|loaded|large|duplicates|all) ;; *) echo "--tier takes triage|loaded|large|duplicates|all" >&2; exit 2 ;; esac
case "$FORCED_LOAD" in ''|low-load|always) ;; *) echo "--forced-load takes low-load|always" >&2; exit 2 ;; esac
case "$WAVES" in ''|1|all) ;; *) echo "--waves takes 1|all" >&2; exit 2 ;; esac
if [ -n "$FORCED_HELD_MIN" ]; then
  awk -v x="$FORCED_HELD_MIN" 'BEGIN { exit !(x ~ /^(0?\.[0-9]+|1(\.0*)?|0\.?)$/ && x + 0 > 0 && x + 0 <= 1) }' \
    || { echo "--forced-held-min takes a share above 0 and at most 1 (for example 0.9)" >&2; exit 2; }
fi
[ "${SB_CHILD:-0}" = 1 ] && MODE=foreground

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() { printf '[%s] %s\n' "$(ts)" "$*"; }
die() { say "FAILED: $*"; exit 1; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
# Command lines matching $BENCH_PROC_PATTERN, minus pgrep/grep and this shell with its ancestors: a $(...) subshell
# carries the script's own command line, and another script's pgrep carries the pattern.
bench_procs() {
  local skip=$BASHPID p=$BASHPID
  while p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); [ -n "$p" ] && [ "$p" -gt 1 ]; do skip="$skip|$p"; done
  pgrep -af "$BENCH_PROC_PATTERN" 2>/dev/null | grep -Ev "^($skip) |^[0-9]+ (pgrep|grep) " || true
}
free_gb() { df -Pk "$1" | awk 'NR==2{printf "%d", $4/1048576}'; }

daemon_pid() {
  local p; p=$(cat "$PIDFILE" 2>/dev/null) || return 1
  alive "$p" && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q 'run-skill-bench' && { echo "$p"; return 0; }
  return 1
}

# ---------------------------------------------------------------- preflight
PF_FAIL=0
pf() { # ok|WARN|FAIL message
  case "$1" in
    ok) say "preflight ok:   $2" ;;
    WARN) say "preflight WARN: $2" ;;
    *) say "preflight FAIL: $2"; PF_FAIL=1 ;;
  esac
}
# A credentials problem is a warning for a dry run and a failure for anything that would launch.
cred_level() { [ "$MODE" = dry-run ] && echo WARN || echo FAIL; }

preflight() {
  PF_FAIL=0
  say "REQUIRES the overall-capability study (real and pilot suites) to have finished: this study shares the checkout and must not overlap it"
  [ -f "$CLI_JS" ] && pf ok "bench runner $CLI_JS" || pf FAIL "bench runner not found: $CLI_JS"
  command -v node >/dev/null && pf ok "node $(node --version)" || pf FAIL "node not found"
  git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 && pf ok "repo $REPO" || pf FAIL "not a git repository: $REPO"
  if git -C "$REPO" rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null 2>&1; then
    pf ok "base ref $BASE_REF at $(git -C "$REPO" rev-parse --short=8 "$BASE_REF^{commit}")"
  else pf FAIL "base ref $BASE_REF does not resolve in $REPO"; fi

  # another bench study must not be running
  local f p active=""
  for f in $OTHER_PIDFILES; do
    p=$(cat "$STATE_DIR/$f" 2>/dev/null) || continue
    alive "$p" && active="$active $f(pid $p)"
  done
  if [ -n "$active" ]; then
    pf FAIL "another bench study is active:$active. Wait for the capability study to finish (or remove a stale pid file if that process is unrelated)"
  else pf ok "no other study pid file is alive ($OTHER_PIDFILES)"; fi
  local procs
  procs=$(bench_procs)
  [ -z "$procs" ] && pf ok "no bench.js process is running" || pf FAIL "another bench study is active (bench.js is running): $(echo "$procs" | head -3 | tr '\n' ';')"
  if [ "${SB_CHILD:-0}" != 1 ] && daemon_pid >/dev/null; then pf FAIL "run-skill-bench is already running (pid $(daemon_pid))"; else pf ok "no run-skill-bench daemon"; fi
  pgrep -af 'konductor[^ ]* (install|update)' 2>/dev/null | grep -v pgrep >/dev/null && pf FAIL "a konductor install or update is running" || pf ok "no konductor install or update running"

  # credentials: the path only is checked, the contents are never read or printed
  local lvl; lvl=$(cred_level)
  if [ -z "$CREDS" ] || [ ! -s "$CREDS" ] || [ ! -r "$CREDS" ]; then
    pf "$lvl" "credentials file ${CREDS:-(CREDS is unset)} is missing or empty: judging needs freshly vended credentials (set CREDS to the file)"
  elif [ -n "$CREDS_EXPIRY_UTC" ] && [ "$(date -u +%s)" -ge "$(date -u -d "$CREDS_EXPIRY_UTC" +%s 2>/dev/null || echo 0)" ]; then
    pf "$lvl" "credentials file $CREDS expired at $CREDS_EXPIRY_UTC: vend fresh credentials"
  else pf ok "credentials file $CREDS present${CREDS_EXPIRY_UTC:+ (expires $CREDS_EXPIRY_UTC)}"; fi

  if [ "${NO_KIRO_CHECK:-0}" != 1 ]; then
    if kiro-cli whoami >/dev/null 2>&1; then pf ok "kiro-cli logged in"; else pf "$lvl" "kiro-cli is not logged in (kiro-cli whoami failed)"; fi
    [ -r "$AUTH_DB" ] && pf ok "auth database $AUTH_DB" || pf "$lvl" "auth database missing: $AUTH_DB"
  fi
  if [ "${NO_OPENCODE_CHECK:-0}" != 1 ]; then
    [ -n "$OC" ] && [ -x "$OC" ] && pf ok "opencode binary $OC" || pf "$lvl" "opencode binary not found (set OC)"
  fi
  mkdir -p "$STATE_DIR" "$RESULTS" 2>/dev/null
  return "$PF_FAIL"
}

# ---------------------------------------------------------------- scratch HOME around every node call
CUR_SH=""; CUR_TD=""
cleanup_scratch() {
  local d
  for d in "$CUR_SH" "$CUR_TD"; do
    case "$d" in "$SCRATCH_PARENT"/xq-home.*|"$SCRATCH_PARENT"/xq.*) rm -rf -- "$d" ;; esac
  done
  CUR_SH=""; CUR_TD=""
}
CHILD_PID=""
on_term() {
  say "signal received: stopping the study (the runner flushes its summary as interrupted)"
  [ -n "$CHILD_PID" ] && kill -TERM "$CHILD_PID" 2>/dev/null
}
trap on_term TERM INT HUP
trap cleanup_scratch EXIT

# run_node <args...>: node bench.js with a scratch HOME and a TMPDIR without "bench" in its path. The scratch HOME has no
# rustup settings, so the real toolchain dirs are passed explicitly or cargo finds no default toolchain.
run_node() {
  CUR_SH=$(mktemp -d "$SCRATCH_PARENT/xq-home.XXXXXX") || return 99
  CUR_TD=$(mktemp -d "$SCRATCH_PARENT/xq.XXXXXX") || { cleanup_scratch; return 99; }
  ( cd "$REPO" && exec env HOME="$CUR_SH" TMPDIR="$CUR_TD" CARGO_HOME="$REAL_HOME/.cargo" RUSTUP_HOME="$REAL_HOME/.rustup" node "$CLI_JS" "$@" ) &
  CHILD_PID=$!
  wait "$CHILD_PID"; local rc=$?
  # a trapped signal ends wait early; keep waiting so the scratch dirs outlive the runner's final flush
  while kill -0 "$CHILD_PID" 2>/dev/null; do wait "$CHILD_PID"; rc=$?; done
  CHILD_PID=""
  cleanup_scratch
  return "$rc"
}

plan_args() { # flags shared by skill-plan and skill-study --init; the study plans every skill, tier and skill filters apply when it runs
  local -a a=(--base "$BASE_REF" --repo-root "$REPO" --bench-dir "$BENCH_DIR" --agent-engine "$ENGINE" --model "$MODEL" --profile "$PROFILE" --arm-config "$ARM_CONFIG")
  [ -n "$EXPOSURE_RUNS" ] && a+=(--runs "$EXPOSURE_RUNS")
  [ -n "$RUNS_GLOBS" ] && a+=(--runs-glob "$RUNS_GLOBS")
  [ -n "${REPS:-}" ] && a+=(--reps "$REPS")
  [ -n "${TASKS_PER_SKILL:-}" ] && a+=(--tasks-per-skill "$TASKS_PER_SKILL")
  [ -n "${MAX_SECTIONS:-}" ] && a+=(--max-sections "$MAX_SECTIONS")
  [ "${SCREEN:-1}" = 1 ] && a+=(--screen)
  printf '%s\0' "${a[@]}"
}
study_flags() { # forced-load, held bar and waves: for every cap skill-study call
  local -a a=()
  [ -n "$FORCED_LOAD" ] && a+=(--forced-load "$FORCED_LOAD")
  [ -n "$FORCED_HELD_MIN" ] && a+=(--forced-held-min "$FORCED_HELD_MIN")
  [ -n "$WAVES" ] && a+=(--waves "$WAVES")
  [ ${#a[@]} -gt 0 ] && printf '%s\0' "${a[@]}"
  return 0
}
run_flags() { # flags for the run itself; cache and cargo target live outside the per-call TMPDIR so builds survive between calls
  local -a a=(--budget-usd "$BUDGET_USD" --aws-creds-file "$CREDS" --auth-db "$AUTH_DB" --cache "$CACHE" --cargo-target "$CARGO_TARGET")
  [ -n "$OC" ] && a+=(--opencode-bin "$OC")
  [ -n "${WAVE_BUDGET_CREDITS:-}" ] && a+=(--wave-budget-credits "$WAVE_BUDGET_CREDITS")
  [ -n "$SEED" ] && a+=(--seed "$SEED")
  printf '%s\0' "${a[@]}"
}

study_dir() { [ -s "$STUDYFILE" ] && [ -d "$(cat "$STUDYFILE")" ] && cat "$STUDYFILE"; }

# ---------------------------------------------------------------- entry points
case "$MODE" in
  status)
    if dp=$(daemon_pid); then echo "daemon: running, pid $dp"; else echo "daemon: not running"; fi
    echo "log: $LOG"
    if V=$(study_dir); then run_node cap skill-study --status --study "$V"; else echo "no study yet ($STUDYFILE missing)"; fi
    echo "last 15 log lines:"; tail -n 15 "$LOG" 2>/dev/null | sed 's/^/  /'
    exit 0 ;;
  stop)
    if dp=$(daemon_pid); then kill -TERM "$dp" && echo "sent SIGTERM to $dp; watch: tail -f $LOG"; else echo "not running"; fi
    exit 0 ;;
esac

if [ "${SB_CHILD:-0}" != 1 ]; then
  preflight || die "preflight failed (see lines above); nothing launched"
fi
[ "$MODE" = preflight ] && { say "preflight passed"; exit 0; }

mapfile -d '' -t PA < <(plan_args)
mapfile -d '' -t RF < <(run_flags)
mapfile -d '' -t SF < <(study_flags)

if [ "$MODE" = dry-run ]; then
  say "DRY RUN: nothing is built, planned on disk or run"
  if V=$(study_dir); then
    say "study dir: $V"
    run_node cap skill-study --dry-run --study "$V" ${TIER:+--tier "$TIER"} ${SKILLS:+--only "$SKILLS"} "${SF[@]}" "${RF[@]}"
  else
    say "no study yet; the plan that --init would write (free, no model; shown for the chosen tier and skills):"
    run_node cap skill-plan "${PA[@]}" ${TIER:+--tier "$TIER"} ${SKILLS:+--only "$SKILLS"} ${FORCED_LOAD:+--forced-load "$FORCED_LOAD"}
  fi
  exit $?
fi

# real run: study dir, plan, daemonize
if [ "${SB_CHILD:-0}" != 1 ]; then
  if V=$(study_dir); then say "resuming study $V"
  else
    V=$RESULTS/skill-bench-$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$V"; echo "$V" > "$STUDYFILE"; say "new study $V"
  fi
  run_node cap skill-study --init --study "$V" "${PA[@]}" "${SF[@]}" "${RF[@]}" || die "planning the study failed"
  if [ "$MODE" = daemon ]; then
    mkdir -p "$STATE_DIR"
    SB_CHILD=1 setsid nohup bash "$SELF" --foreground ${TIER:+--tier "$TIER"} ${SKILLS:+--skills "$SKILLS"} ${FORCED_LOAD:+--forced-load "$FORCED_LOAD"} ${FORCED_HELD_MIN:+--forced-held-min "$FORCED_HELD_MIN"} ${WAVES:+--waves "$WAVES"} >> "$LOG" 2>&1 < /dev/null &
    dp=$!
    say "LAUNCHED: pid $dp, study $V"
    say "log:    tail -f $LOG"
    say "status: bash $SELF --status"
    say "stop:   bash $SELF --stop     (resume later: rerun this script)"
    exit 0
  fi
fi

echo $$ > "$PIDFILE"
V=$(study_dir) || die "no study directory ($STUDYFILE)"
say "run-skill-bench started, pid $$, study $V"
run_node cap skill-study --study "$V" ${TIER:+--tier "$TIER"} ${SKILLS:+--only "$SKILLS"} "${SF[@]}" "${RF[@]}"
rc=$?
rm -f -- "$PIDFILE"
if [ "$rc" = 0 ]; then say "DONE: decisions are in $V/decisions/decisions.md (nothing was applied)"; else say "FAILED or stopped (exit $rc). Rerun $SELF to resume."; fi
exit "$rc"
