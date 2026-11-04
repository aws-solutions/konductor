#!/usr/bin/env bash
# pilot-2x2.sh - the 2x2 pilot: Kiro CLI and Claude Code, each without and with konductor, on one model, one judge
# panel. One repetition of five lite tasks per cell by default (20 runs), then judging, then the table.
#
# RUN IT FROM YOUR OWN TERMINAL. It starts kiro-cli (credits) and the real claude binary against Bedrock (USD), and
# calls the judge models on Bedrock (USD). Nothing is started by --dry-run, which reads no credentials.
#
#   bash bench/scripts/pilot-2x2.sh --dry-run --profile NAME --budget-usd 30 --kiro-credit-limit 15 --out /var/tmp/pilot-2x2 \
#     --claude-tools-dir DIR
#   bash bench/scripts/pilot-2x2.sh --profile NAME --budget-usd CEILING --kiro-credit-limit N --out /var/tmp/pilot-2x2 \
#     --claude-tools-dir DIR
#
# Cells and order: kiro-vanilla, kiro-konductor, cc-vanilla, cc-konductor, then judging of each, then `report-2x2`.
#   Each (cell, task) is its own `bench.js run` into OUT/cells/<cell>/<task>, so a rerun skips finished tasks and loses
#   at most one. An unfinished or infra-errored directory is moved to OUT/incomplete/ (never deleted) and rerun.
#   The konductor arm is the same git commit in both harnesses (--konductor-ref, a full commit resolved in this checkout).
#
# Options (budgets have no default: you state the ceiling)
#   --out DIR              required; empty, or the output of an earlier run of this script with the same settings
#   --cells WHICH          all | kiro | cc | judge | report (default all). Rerun with the same --out to resume.
#   --budget-usd N         USD ceiling for the Claude Code runs and the judging together; required for all, cc, judge.
#                          10% is held back for judging; each run call gets the remainder of the other 90%.
#   --run-budget-usd N     claude's cap for one Claude Code run, default 1.5
#   --kiro-credit-limit N  kills a Kiro run once its metered credits pass N; required for all, kiro
#   --reps N               repetitions per task and cell, default 1 (n=1 gives a descriptive table, not statistics)
#   --tasks LIST           comma-separated lite task ids (default: the five tasks of the earlier studies)
#   --seed N               default 1
#   --konductor-ref REF    commit the konductor arms are built from (default: bf07556f9f73, the main commit with the dashed model pins)
#   --profile NAME         AWS profile for the Claude Code runs and the judge; or export AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
#                          and AWS_SESSION_TOKEN yourself. Keys go to the runner by environment (judge: a 0600 file in the scratch
#                          directory, removed after judging); they are never printed, put on a command line or kept in OUT.
#   --refresh-cmd CMD      if the credential export fails, run CMD once in your normal environment (terminal attached), then retry once
#   --region REGION        default us-east-1          --account ID   refuse to run unless the credentials resolve to this account
#   --claude-bin PATH | --claude-tools-dir DIR   the claude binary (env BENCH_CLAUDE_BIN, BENCH_CLAUDE_TOOLS_DIR); a launcher is refused
#   --opencode-bin PATH    judge runner (default: opencode on PATH)     --kiro-bin PATH   (default: kiro-cli on PATH)
#   --auth-db FILE         kiro-cli login database (default ~/.local/share/kiro-cli/data.sqlite3; checked as a file only)
#   --isolate MODE         passed to bench.js (auto, unshare, sandbox-exec, none; none also passes --allow-unisolated)
#   --dry-run              print the plan, the exact commands and the preflight results; run nothing, read no credentials
#   --keep                 keep the scratch directory
#
# Exit codes: 0 done, 1 a step failed or cells are not ready, 2 usage or preflight error (nothing was run).

set -euo pipefail
case $- in *x*) set +x ;; esac
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPER="$SCRIPT_DIR/pilot-2x2.js"
CC_HELPER="$SCRIPT_DIR/claude-code-smoke.js"
BENCH_JS="${PILOT_BENCH_JS:-$REPO/bench/runner/bench.js}"
SCRATCH_ROOT="${PILOT_SCRATCH_ROOT:-/var/tmp}"
CLAUDE_TMP_BASE="${PILOT_CLAUDE_TMP_BASE:-/tmp}"
PROC_PATTERN="${PILOT_PROC_PATTERN:-bench/runner/bench[.]js}"
MIN_FREE_GB="${PILOT_MIN_FREE_GB:-15}"

DEFAULT_REF=bf07556f9f7358e8a7190ef1a200950ffe8185de
DEFAULT_TASKS=simple-fix-failing-test,simple-explain-file,orch-input-validation,review-inventory-security,design-hold-service
KIRO_MODEL=claude-sonnet-5.5
KIRO_ENGINE=v3
CC_MODEL=us.anthropic.claude-sonnet-5-5
PANEL=gpt-5.6-luna,deepseek-3.2,glm-5
JUDGE_RESERVE_PCT=10
CELL_NAMES=(kiro-vanilla kiro-konductor cc-vanilla cc-konductor)

OUT=""
CELLS=all
BUDGET_USD=""
RUN_BUDGET_USD=1.5
KIRO_LIMIT=""
REPS=1
TASKS_CSV="$DEFAULT_TASKS"
SEED=1
REF="$DEFAULT_REF"
PROFILE=""
REFRESH_CMD="${PILOT_REFRESH_CMD:-}"
REGION=us-east-1
ACCOUNT=""
CLAUDE_BIN_OPT="${BENCH_CLAUDE_BIN:-}"
CLAUDE_TOOLS_DIR_OPT="${BENCH_CLAUDE_TOOLS_DIR:-}"
OPENCODE_BIN_OPT=""
KIRO_BIN_OPT=""
AUTH_DB="${HOME:-}/.local/share/kiro-cli/data.sqlite3"
ISOLATE=""
DRY_RUN=0
KEEP=0

SCRATCH=""
SCRATCH_SLUG=""
UID_NUM="$(id -u)"
FAILURES=()
PREFLIGHT_FAILED=0
REFRESHED=0
CLAUDE_BIN=""
OPENCODE_BIN=""
KIRO_BIN=""

say() { printf '[pilot] %s\n' "$*"; }
die() { printf '[pilot] ERROR: %s\n' "$*" >&2; exit 2; }
check() { # check PASS|FAIL text
  printf '%-5s %s\n' "$1" "$2"
  if [ "$1" = FAIL ]; then PREFLIGHT_FAILED=1; fi
}
usage() { sed -n '2,/^# Exit codes/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out needs a directory}"; shift 2 ;;
    --cells) CELLS="${2:?--cells needs all, kiro, cc, judge or report}"; shift 2 ;;
    --budget-usd) BUDGET_USD="${2:?--budget-usd needs a number}"; shift 2 ;;
    --run-budget-usd) RUN_BUDGET_USD="${2:?--run-budget-usd needs a number}"; shift 2 ;;
    --kiro-credit-limit) KIRO_LIMIT="${2:?--kiro-credit-limit needs a number}"; shift 2 ;;
    --reps) REPS="${2:?--reps needs a number}"; shift 2 ;;
    --tasks) TASKS_CSV="${2:?--tasks needs a comma-separated list}"; shift 2 ;;
    --seed) SEED="${2:?--seed needs a number}"; shift 2 ;;
    --konductor-ref) REF="${2:?--konductor-ref needs a commit}"; shift 2 ;;
    --profile) PROFILE="${2:?--profile needs a name}"; shift 2 ;;
    --refresh-cmd) REFRESH_CMD="${2:?--refresh-cmd needs a command}"; shift 2 ;;
    --region) REGION="${2:?--region needs a value}"; shift 2 ;;
    --account) ACCOUNT="${2:?--account needs an id}"; shift 2 ;;
    --claude-bin) CLAUDE_BIN_OPT="${2:?--claude-bin needs a path}"; shift 2 ;;
    --claude-tools-dir) CLAUDE_TOOLS_DIR_OPT="${2:?--claude-tools-dir needs a directory}"; shift 2 ;;
    --opencode-bin) OPENCODE_BIN_OPT="${2:?--opencode-bin needs a path}"; shift 2 ;;
    --kiro-bin) KIRO_BIN_OPT="${2:?--kiro-bin needs a path}"; shift 2 ;;
    --auth-db) AUTH_DB="${2:?--auth-db needs a file}"; shift 2 ;;
    --isolate) ISOLATE="${2:?--isolate needs a mode}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --keep) KEEP=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

# ---------------------------------------------------------------- validation
is_pos() { awk -v v="$1" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/ && v + 0 > 0) }'; }
is_int() { case "$1" in '' | *[!0-9]*) return 1 ;; esac; [ "$1" -gt 0 ]; }

case "$CELLS" in all | kiro | cc | judge | report) ;; *) die "--cells takes all, kiro, cc, judge or report" ;; esac
[ -n "$OUT" ] || die "--out DIR is required"
do_kiro=0; do_cc=0; do_judge=0; do_report=0
case "$CELLS" in
  all) do_kiro=1; do_cc=1; do_judge=1; do_report=1 ;;
  kiro) do_kiro=1 ;;
  cc) do_cc=1 ;;
  judge) do_judge=1 ;;
  report) do_report=1 ;;
esac
if [ $((do_cc + do_judge)) -gt 0 ]; then
  [ -n "$BUDGET_USD" ] || die "--budget-usd is required for --cells $CELLS (the USD ceiling for the Claude Code runs and the judging; there is no default)"
  is_pos "$BUDGET_USD" || die "--budget-usd must be a positive number"
fi
if [ "$do_kiro" -eq 1 ]; then
  [ -n "$KIRO_LIMIT" ] || die "--kiro-credit-limit is required for --cells $CELLS (the credit limit of one Kiro run; there is no default)"
  is_pos "$KIRO_LIMIT" || die "--kiro-credit-limit must be a positive number"
fi
is_pos "$RUN_BUDGET_USD" || die "--run-budget-usd must be a positive number"
is_int "$REPS" || die "--reps must be a positive integer"
is_int "$SEED" || die "--seed must be a positive integer"
IFS=',' read -r -a TASKS <<<"$TASKS_CSV"
[ "${#TASKS[@]}" -gt 0 ] || die "--tasks is empty"
for t in "${TASKS[@]}"; do
  case "$t" in '' | *[!a-z0-9._-]*) die "task id '$t' is not a task id (lowercase letters, digits, . _ -)" ;; esac
done
[ "$(printf '%s\n' "${TASKS[@]}" | sort -u | wc -l)" -eq "${#TASKS[@]}" ] || die "--tasks lists a task twice"
OUT="$(realpath -m -- "$OUT")"
REPO_REAL="$(cd "$REPO" && pwd -P)"
case "$OUT" in "$REPO" | "$REPO"/* | "$REPO_REAL" | "$REPO_REAL"/*) die "--out must be outside the checkout ($REPO)" ;; esac
case "$OUT" in *,*) die "--out must not contain a comma (the table step takes comma separated directory lists)" ;; esac
[ -f "$BENCH_JS" ] || die "bench runner not found at $BENCH_JS"
command -v node >/dev/null 2>&1 || die "node is not on PATH"
SHA="$(git -C "$REPO" rev-parse --verify --quiet "${REF}^{commit}")" || die "--konductor-ref $REF is not a commit in $REPO"

INIT_ARGS=(--tasks "$TASKS_CSV" --reps "$REPS" --seed "$SEED" --ref "$SHA" --kiro-model "$KIRO_MODEL" --cc-model "$CC_MODEL")
if [ "$DRY_RUN" -eq 1 ]; then INIT_ARGS+=(--dry-run); fi
INIT="$(node "$HELPER" init-out "$OUT" "${INIT_ARGS[@]}")" || die "${INIT#FAIL }"
case "$INIT" in fresh | resume) ;; *) die "${INIT#FAIL }" ;; esac

# ---------------------------------------------------------------- scratch and cleanup
SCRATCH="$(mktemp -d "$SCRATCH_ROOT/pilot-2x2.XXXXXX")"
SCRATCH_SLUG="$(cd "$SCRATCH" && pwd -P | sed 's/[^A-Za-z0-9]/-/g')"
mkdir -p "$SCRATCH/home" "$SCRATCH/tmp"

own_claude_tmp() {
  local d="$CLAUDE_TMP_BASE/claude-$UID_NUM"
  if [ -n "$SCRATCH_SLUG" ] && [ -d "$d" ]; then find "$d" -mindepth 1 -maxdepth 1 -name "${SCRATCH_SLUG}*" 2>/dev/null | LC_ALL=C sort; fi
}

# shellcheck disable=SC2329  # installed with trap
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  set +e
  AWS_ACCESS_KEY_ID="" AWS_SECRET_ACCESS_KEY="" AWS_SESSION_TOKEN=""
  rm -rf -- "$SCRATCH/judge-aws"
  if [ -n "$SCRATCH" ] && [ "$KEEP" -eq 1 ]; then
    say "kept scratch directory: $SCRATCH"
  elif [ -n "$SCRATCH" ]; then
    local p d="$CLAUDE_TMP_BASE/claude-$UID_NUM"
    while IFS= read -r p; do [ -n "$p" ] && rm -rf -- "$p"; done < <(own_claude_tmp)
    rmdir -- "$d" 2>/dev/null || true
    case "$SCRATCH" in "$SCRATCH_ROOT"/pilot-2x2.??*) [ -d "$SCRATCH" ] && rm -rf -- "$SCRATCH" ;; esac
  fi
  exit "$rc"
}
kill_children() { # kill_children PID: TERM every descendant of PID, deepest first
  local p
  for p in $(pgrep -P "$1" 2>/dev/null); do
    kill_children "$p"
    kill -TERM "$p" 2>/dev/null || true
  done
}
trap cleanup EXIT
# shellcheck disable=SC2064  # $$ is this shell, expanded when the trap is set
trap "kill_children $$; exit 143" TERM
# shellcheck disable=SC2064
trap "kill_children $$; exit 130" INT

# ---------------------------------------------------------------- credentials (same handling as claude-code-smoke.sh)
CRED_ERR=""

parse_export_output() {
  local text="$1" line name val ak="" sk="" st=""
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#export }"
    case "$line" in
      AWS_ACCESS_KEY_ID=* | AWS_SECRET_ACCESS_KEY=* | AWS_SESSION_TOKEN=*)
        name="${line%%=*}"
        val="${line#*=}"
        case "$val" in
          \"*\") val="${val#\"}"; val="${val%\"}" ;;
          \'*\') val="${val#\'}"; val="${val%\'}" ;;
        esac
        case "$name" in
          AWS_ACCESS_KEY_ID) ak="$val" ;;
          AWS_SECRET_ACCESS_KEY) sk="$val" ;;
          AWS_SESSION_TOKEN) st="$val" ;;
        esac
        ;;
    esac
  done <<<"$text"
  if [ -z "$ak" ] || [ -z "$sk" ]; then CRED_ERR="the output had no access key id and secret"; return 1; fi
  if [ "${ak:0:4}" = ASIA ] && [ -z "$st" ]; then CRED_ERR="a temporary (ASIA) key without a session token"; return 1; fi
  export AWS_ACCESS_KEY_ID="$ak" AWS_SECRET_ACCESS_KEY="$sk"
  if [ -n "$st" ]; then export AWS_SESSION_TOKEN="$st"; else unset AWS_SESSION_TOKEN; fi
}

redact_line() {
  local line
  line="$(printf '%s\n' "$1" | head -n 1 | sed -E 's/A[SK]IA[0-9A-Z]{16}/[redacted]/g')"
  if printf '%s' "$line" | grep -qiE 'secret|token'; then line="$(printf '%s' "$line" | sed -E 's/=.*/=[redacted]/')"; fi
  printf '%.200s' "$line"
}

EXPORT_OUT=""
try_export() {
  local errf="$SCRATCH/export.err" rc=0
  EXPORT_OUT="$(aws configure export-credentials --profile "$PROFILE" --format env 2>"$errf")" || rc=$?
  if [ "$rc" -ne 0 ]; then printf '[pilot] export-credentials failed: %s\n' "$(redact_line "$(cat "$errf")")" >&2; fi
  rm -f -- "$errf"
  return "$rc"
}

# Exports the three AWS variables into this shell. With a profile it exports again each time (keys expire during a
# long pilot); the refresh command runs at most once per script run.
load_credentials() {
  if [ -z "$PROFILE" ]; then
    [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || die "no credentials: pass --profile NAME, or export AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN"
    return 0
  fi
  command -v aws >/dev/null 2>&1 || die "the aws CLI is not on PATH (needed for --profile)"
  if ! try_export; then
    [ -n "$REFRESH_CMD" ] && [ "$REFRESHED" -eq 0 ] || die "aws configure export-credentials failed for profile $PROFILE (--refresh-cmd CMD can refresh and retry once)"
    REFRESHED=1
    say "running the credentials refresh command (it may ask you to log in)"
    local rc=0
    bash -c "$REFRESH_CMD" || rc=$?
    [ "$rc" -eq 0 ] || die "the refresh command failed (exit $rc)"
    try_export || die "aws configure export-credentials still failed after the refresh command"
  fi
  parse_export_output "$EXPORT_OUT" || die "export-credentials output unusable: $CRED_ERR"
  say "exported credentials from profile $PROFILE (values not shown)"
}

# ---------------------------------------------------------------- preflight
preflight_common() {
  local free_kb
  free_kb="$(df -Pk "$SCRATCH_ROOT" | awk 'NR==2 { print $4 }')"
  if [ -n "$free_kb" ] && [ "$((free_kb / 1048576))" -ge "$MIN_FREE_GB" ]; then check PASS "disk: $((free_kb / 1048576)) GB free under $SCRATCH_ROOT (need $MIN_FREE_GB)"; else check FAIL "disk: ${free_kb:-0} KB free under $SCRATCH_ROOT, need $MIN_FREE_GB GB"; fi
  local others
  others="$(pgrep -af "$PROC_PATTERN" 2>/dev/null | grep -Ev "^$$ |^[0-9]+ (pgrep|grep) " || true)"
  if [ -z "$others" ]; then check PASS "no other bench runner process is running"; else check FAIL "another bench runner process is running: $(printf '%s' "$others" | head -1 | cut -c1-120)"; fi
  check PASS "konductor commit ${SHA:0:12} resolved in $REPO (the same commit builds both konductor arms)"
}

preflight_kiro() {
  if [ -n "$KIRO_BIN_OPT" ]; then KIRO_BIN="$KIRO_BIN_OPT"; else KIRO_BIN="$(command -v kiro-cli || true)"; fi
  if [ -n "$KIRO_BIN" ] && [ -x "$KIRO_BIN" ]; then check PASS "kiro-cli found at $KIRO_BIN"; else check FAIL "kiro-cli not found (--kiro-bin PATH)"; fi
  if [ -s "$AUTH_DB" ]; then check PASS "kiro-cli login database present at $AUTH_DB (file check only; it does not prove the login is current)"; else check FAIL "no kiro-cli login database at $AUTH_DB; log in with kiro-cli, or pass --auth-db FILE"; fi
}

CLAUDE_VERSION=""
preflight_claude() {
  local line
  if line="$(node "$CC_HELPER" resolve ${CLAUDE_BIN_OPT:+--claude-bin "$CLAUDE_BIN_OPT"} ${CLAUDE_TOOLS_DIR_OPT:+--claude-tools-dir "$CLAUDE_TOOLS_DIR_OPT"} 2>&1)"; then
    IFS=$'\t' read -r CLAUDE_BIN CLAUDE_VERSION _ _ <<<"$line"
    check PASS "claude $CLAUDE_VERSION at $CLAUDE_BIN"
  else
    check FAIL "no usable claude binary: ${line#FAIL resolve: } (--claude-bin PATH or --claude-tools-dir DIR)"
  fi
}

preflight_opencode() {
  if [ -n "$OPENCODE_BIN_OPT" ]; then OPENCODE_BIN="$OPENCODE_BIN_OPT"; else OPENCODE_BIN="$(command -v opencode || true)"; fi
  if [ -n "$OPENCODE_BIN" ] && [ -x "$OPENCODE_BIN" ]; then check PASS "opencode (judge runner) found at $OPENCODE_BIN"; else check FAIL "opencode not found (--opencode-bin PATH)"; fi
}

preflight_aws() { # live check: needs credentials; not run with --dry-run
  load_credentials
  command -v aws >/dev/null 2>&1 || die "the aws CLI is not on PATH"
  local line
  if line="$(node "$CC_HELPER" preflight --region "$REGION" --home "$SCRATCH/home" --tmp "$SCRATCH/tmp" ${ACCOUNT:+--account "$ACCOUNT"})"; then printf '%s\n' "$line"; else printf '%s\n' "$line"; die "credential preflight failed; nothing was run"; fi
}

# ---------------------------------------------------------------- commands
cell_dir() { printf '%s/cells/%s/%s' "$OUT" "$1" "$2"; }

cc_allowance() { # USD still available to Claude Code runs: (budget - judge reserve) - spent
  local spent
  spent="$(node "$HELPER" spend "$OUT" | sed -E 's/.*cc_usd=([0-9.]+).*/\1/')"
  awk -v b="$BUDGET_USD" -v r="$JUDGE_RESERVE_PCT" -v s="$spent" 'BEGIN { printf "%.4f", b * (100 - r) / 100 - s }'
}
judge_allowance() { # USD still available to judging: budget - Claude Code spend - judge spend
  local line cc j
  line="$(node "$HELPER" spend "$OUT")"
  cc="$(printf '%s' "$line" | sed -E 's/.*cc_usd=([0-9.]+).*/\1/')"
  j="$(printf '%s' "$line" | sed -E 's/.*judge_usd=([0-9.]+).*/\1/')"
  awk -v b="$BUDGET_USD" -v c="$cc" -v j="$j" 'BEGIN { printf "%.4f", b - c - j }'
}

common_run_args() { # common_run_args TASK ARMS OUTDIR
  printf '%s\0' run --suite lite --tasks "$1" --arms "$2" --out "$3" --seed "$SEED" --replicates "$REPS" --parallel 1 --repo-root "$REPO" --cache "$OUT/cache" --cargo-target "$OUT/cargo-target"
  if [ -n "$ISOLATE" ]; then
    printf '%s\0' --isolate "$ISOLATE"
    if [ "$ISOLATE" = none ]; then printf '%s\0' --allow-unisolated; fi
  fi
}
arms_of() { # arms_of CELL
  case "$1" in
    kiro-vanilla) printf 'vanilla' ;;
    kiro-konductor) printf 'konductor=%s' "$SHA" ;;
    cc-vanilla) printf 'cc-vanilla' ;;
    cc-konductor) printf 'cc-konductor=%s' "$SHA" ;;
  esac
}
run_args() { # run_args CELL TASK [ALLOWANCE]
  local cell=$1 task=$2 allow=${3:-<remaining>}
  common_run_args "$task" "$(arms_of "$cell")" "$(cell_dir "$cell" "$task")"
  case "$cell" in
    kiro-*)
      printf '%s\0' --model "$KIRO_MODEL" --agent-engine "$KIRO_ENGINE" --run-credit-limit "$KIRO_LIMIT" --auth-db "$AUTH_DB"
      if [ -n "$KIRO_BIN_OPT" ]; then printf '%s\0' --kiro-bin "$KIRO_BIN_OPT"; fi
      ;;
    cc-*) printf '%s\0' --model "$CC_MODEL" --budget-usd "$allow" --run-budget-usd "$RUN_BUDGET_USD" --aws-region "$REGION" --claude-bin "${CLAUDE_BIN:-<claude>}" ;;
  esac
}
judge_args() { # judge_args DIR BUDGET CREDSFILE
  printf '%s\0' judge --run "$1" --judge-backend opencode --judges "$PANEL" --mode rubric --concurrency 2 --budget-usd "$2" \
    --opencode-bin "${OPENCODE_BIN:-<opencode>}" --aws-creds-file "$3" --aws-profile bench --aws-region "$REGION"
}
report_args() {
  local c t joined args=(report-2x2 --out "$OUT/report")
  for c in "${CELL_NAMES[@]}"; do
    joined=""
    for t in "${TASKS[@]}"; do joined="${joined:+$joined,}$(cell_dir "$c" "$t")"; done
    case "$c" in
      kiro-vanilla) args+=(--kiro-vanilla "$joined") ;;
      kiro-konductor) args+=(--kiro-konductor "$joined") ;;
      cc-vanilla) args+=(--cc-vanilla "$joined") ;;
      cc-konductor) args+=(--cc-konductor "$joined") ;;
    esac
  done
  printf '%s\0' "${args[@]}"
}
show() { # show NUL-delimited args from stdin as one quoted command line
  local a line="node $BENCH_JS"
  while IFS= read -r -d '' a; do
    case "$a" in
      *[!A-Za-z0-9_@%+=:,./\<\>-]* | '') line+=" $(printf '%q' "$a")" ;;
      *) line+=" $a" ;;
    esac
  done
  printf '  %s\n' "$line"
}

# run_bench ARGS...: bench.js in a scratch TMPDIR (path without the word "bench"), with the AWS variables only for Claude Code and judge.
run_bench() {
  (
    cd "$REPO"
    export TMPDIR="$SCRATCH/tmp"
    unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE
    nice -n 10 node "$BENCH_JS" "$@"
  )
}

# ---------------------------------------------------------------- plan
runs_per_cell=$((${#TASKS[@]} * REPS))
print_plan() {
  local c t
  say "2x2 pilot: cells $CELLS, tasks ${TASKS[*]}, $REPS rep(s) per task: $runs_per_cell runs per cell, $((runs_per_cell * 4)) in all"
  say "model: Kiro $KIRO_MODEL (engine $KIRO_ENGINE), Claude Code $CC_MODEL; konductor commit $SHA in both harnesses"
  say "judge: opencode on Bedrock, panel $PANEL, rubric mode, same panel for all four cells"
  say "out: $OUT (cells/, incomplete/, report/, cache/, cargo-target/); scratch under $SCRATCH_ROOT, removed on exit"
  if [ -n "$BUDGET_USD" ]; then
    say "ceilings: \$$BUDGET_USD for Claude Code runs plus judging (\$$(awk -v b="$BUDGET_USD" -v r="$JUDGE_RESERVE_PCT" 'BEGIN { printf "%.2f", b * (100 - r) / 100 }') for runs, the rest for judging), at most \$$RUN_BUDGET_USD per Claude Code run"
    say "worst case, Claude Code runs: $((runs_per_cell * 2)) runs x \$$RUN_BUDGET_USD = \$$(awk -v n="$((runs_per_cell * 2))" -v c="$RUN_BUDGET_USD" 'BEGIN { printf "%.2f", n * c }') (capped by the ceiling)"
  fi
  if [ -n "$KIRO_LIMIT" ]; then say "worst case, Kiro runs: $((runs_per_cell * 2)) runs x $KIRO_LIMIT credits = $(awk -v n="$((runs_per_cell * 2))" -v c="$KIRO_LIMIT" 'BEGIN { printf "%.1f", n * c }') credits"; fi
  say "cost expectations are unmeasured for this setup; the pilot exists to measure them"
  echo
  if [ "$do_kiro" -eq 1 ]; then
    echo "Kiro runs (kiro-vanilla, kiro-konductor), one bench.js call per task:"
    for c in kiro-vanilla kiro-konductor; do for t in "${TASKS[@]}"; do run_args "$c" "$t" | show; done; done
  fi
  if [ "$do_cc" -eq 1 ]; then
    echo "Claude Code runs (cc-vanilla, cc-konductor); <remaining> is the Claude Code allowance left at that moment:"
    for c in cc-vanilla cc-konductor; do for t in "${TASKS[@]}"; do run_args "$c" "$t" | show; done; done
  fi
  if [ "$do_judge" -eq 1 ]; then
    echo "Judging, one call per finished (cell, task) directory; the credentials file is made in the scratch directory and removed after:"
    for c in "${CELL_NAMES[@]}"; do for t in "${TASKS[@]}"; do judge_args "$(cell_dir "$c" "$t")" "<remaining>" "<scratch>/judge-aws/credentials" | show; done; done
  fi
  if [ "$do_report" -eq 1 ]; then
    echo "Table:"
    report_args | show
  fi
  echo
}

# ---------------------------------------------------------------- phases
move_aside() { # move_aside CELL TASK
  local src dest
  src="$(cell_dir "$1" "$2")"
  dest="$OUT/incomplete/$1-$2-$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$OUT/incomplete"
  mv -- "$src" "$dest"
  say "moved the unfinished $1/$2 to $dest"
}

run_cell() { # run_cell CELL
  local cell=$1 task state allow
  local -a args=()
  for task in "${TASKS[@]}"; do
    state="$(node "$HELPER" cell-state "$(cell_dir "$cell" "$task")" "$REPS")"
    if [ "$state" = complete ]; then say "$cell/$task: already finished, skipped"; continue; fi
    if [ "$state" != missing ]; then move_aside "$cell" "$task"; fi
    allow=""
    case "$cell" in
      cc-*)
        allow="$(cc_allowance)"
        if ! awk -v a="$allow" 'BEGIN { exit !(a > 0) }'; then
          FAILURES+=("$cell/$task: the Claude Code allowance is used up; rerun with a higher --budget-usd to continue")
          say "$cell/$task: allowance used up, stopping Claude Code runs"
          return 0
        fi
        load_credentials
        ;;
    esac
    args=()
    while IFS= read -r -d '' a; do args+=("$a"); done < <(run_args "$cell" "$task" "$allow")
    say "$cell/$task: running"
    mkdir -p "$(dirname "$(cell_dir "$cell" "$task")")"
    if ! (case "$cell" in kiro-*) unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN ;; esac; run_bench "${args[@]}") >>"$OUT/logs/$cell.log" 2>&1; then
      FAILURES+=("$cell/$task: bench.js exited nonzero (see $OUT/logs/$cell.log)")
      say "$cell/$task: FAILED (see $OUT/logs/$cell.log)"
    fi
  done
}

write_judge_credentials() {
  local d="$SCRATCH/judge-aws"
  mkdir -p "$d"
  {
    printf '[bench]\naws_access_key_id = %s\naws_secret_access_key = %s\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY"
    if [ -n "${AWS_SESSION_TOKEN:-}" ]; then printf 'aws_session_token = %s\n' "$AWS_SESSION_TOKEN"; fi
  } >"$d/credentials"
  chmod 600 "$d/credentials"
}

judge_all() {
  local c t dir state allow
  local -a args=()
  load_credentials
  write_judge_credentials
  for c in "${CELL_NAMES[@]}"; do
    for t in "${TASKS[@]}"; do
      dir="$(cell_dir "$c" "$t")"
      state="$(node "$HELPER" cell-state "$dir" "$REPS")"
      if [ "$state" != complete ]; then FAILURES+=("$c/$t: not judged, the run is $state"); continue; fi
      if [ "$(node "$HELPER" judged "$dir" --judges "$PANEL")" = full ]; then say "$c/$t: already judged, skipped"; continue; fi
      allow="$(judge_allowance)"
      if ! awk -v a="$allow" 'BEGIN { exit !(a > 0) }'; then FAILURES+=("$c/$t: the USD ceiling is used up before judging finished; rerun with a higher --budget-usd"); continue; fi
      args=()
      while IFS= read -r -d '' a; do args+=("$a"); done < <(judge_args "$dir" "$allow" "$SCRATCH/judge-aws/credentials")
      say "$c/$t: judging"
      if ! (unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; HOME="$SCRATCH/home" run_bench "${args[@]}") >>"$OUT/logs/judge.log" 2>&1; then
        FAILURES+=("$c/$t: judge exited nonzero (see $OUT/logs/judge.log)")
        say "$c/$t: judge FAILED (see $OUT/logs/judge.log)"
      fi
    done
  done
  rm -rf -- "$SCRATCH/judge-aws"
}

report_all() {
  local c t not_ready=()
  for c in "${CELL_NAMES[@]}"; do
    for t in "${TASKS[@]}"; do
      if [ "$(node "$HELPER" cell-state "$(cell_dir "$c" "$t")" "$REPS")" != complete ]; then not_ready+=("$c/$t not finished")
      elif [ "$(node "$HELPER" judged "$(cell_dir "$c" "$t")" --judges "$PANEL")" != full ]; then not_ready+=("$c/$t not fully judged"); fi
    done
  done
  if [ "${#not_ready[@]}" -gt 0 ]; then
    local more=""
    if [ "${#not_ready[@]}" -gt 6 ]; then more=" ..."; fi
    FAILURES+=("the table needs every cell finished and judged; missing: ${not_ready[*]:0:6}$more")
    return 0
  fi
  local -a args=()
  while IFS= read -r -d '' a; do args+=("$a"); done < <(report_args)
  mkdir -p "$OUT/report"
  say "building the 2x2 table"
  if run_bench "${args[@]}" 2>"$OUT/logs/report.err"; then echo; else FAILURES+=("report-2x2 refused the cells: $(head -3 "$OUT/logs/report.err" | tr '\n' ' ')"); fi
}

# ---------------------------------------------------------------- main
echo "== preflight =="
preflight_common
if [ "$do_kiro" -eq 1 ]; then preflight_kiro; fi
if [ "$do_cc" -eq 1 ]; then preflight_claude; fi
if [ "$do_judge" -eq 1 ]; then preflight_opencode; fi
if [ "$PREFLIGHT_FAILED" -ne 0 ]; then echo; die "preflight failed; nothing was run"; fi
echo

if [ "$DRY_RUN" -eq 1 ]; then
  say "dry run: no credentials are read, no network is used and nothing is started"
  print_plan
  exit 0
fi

if [ $((do_cc + do_judge)) -gt 0 ]; then
  load_credentials
  preflight_aws
fi
print_plan | sed -n '1,/^$/p'
mkdir -p "$OUT/logs"

if [ "$do_kiro" -eq 1 ]; then run_cell kiro-vanilla; run_cell kiro-konductor; fi
if [ "$do_cc" -eq 1 ]; then run_cell cc-vanilla; run_cell cc-konductor; fi
if [ "$do_judge" -eq 1 ]; then judge_all; fi
if [ "$do_report" -eq 1 ]; then report_all; fi

echo
echo "== spend =="
node "$HELPER" summary "$OUT"
LEFT="$(own_claude_tmp)"
if [ -n "$LEFT" ]; then say "removing this run's leftovers in $CLAUDE_TMP_BASE/claude-$UID_NUM"; fi
if [ "${#FAILURES[@]}" -gt 0 ]; then
  echo
  say "NOT DONE:"
  printf '  - %s\n' "${FAILURES[@]}"
  say "fix the cause and rerun the same command with the same --out; finished tasks are skipped"
  exit 1
fi
say "done. Table: $OUT/report/factorial-2x2.md"
