#!/usr/bin/env bash
# claude-code-smoke.sh - run one tiny vanilla task and one tiny konductor task through the Claude Code bench
# harness on Bedrock, then check the results.
#
# RUN IT FROM YOUR OWN TERMINAL. It starts the real claude binary against Bedrock (a few cents; the default caps are
# $0.60 per run and $1.50 in total).
#
#   bash bench/scripts/claude-code-smoke.sh --profile NAME
#
# What it does:
#   1. Finds the real claude binary: --claude-bin, or the newest <version>/claude under --claude-tools-dir (BENCH_CLAUDE_BIN,
#      BENCH_CLAUDE_TOOLS_DIR). A launcher script is refused.
#   2. Takes AWS credentials from the environment, or exports them from --profile with
#      `aws configure export-credentials`. They are handed to the bench through its environment only, never a file
#      or a command line.
#   3. Checks them with `aws sts get-caller-identity` under claude's exact environment (scratch HOME, exported keys,
#      no profile variables).
#   4. Runs `bench.js run` twice: a vanilla task, then a task that makes the konductor arm delegate to a sub-agent.
#   5. Prints PASS or FAIL per criterion: result.json parses and matches the schema, the run succeeded, cost > 0, one
#      canonical model, the konductor run delegated at least once with no failed spawn, 11 agents installed with the
#      model pin, no credential value in any output, nothing of this run left in /tmp/claude-<uid>, nothing left in the scratch dirs.
#   6. Removes everything it created (scratch directories, this run's /tmp/claude-<uid> entries), also on Ctrl-C. Entries of
#      other Claude Code sessions are never touched.
#
# Options:
#   --profile NAME      AWS profile to export credentials from (not needed when AWS_ACCESS_KEY_ID and
#                       AWS_SECRET_ACCESS_KEY are already exported)
#   --region REGION     default us-east-1
#   --account ID        refuse to run unless the credentials resolve to this account
#   --arm SPEC          konductor arm for the second run, default cc-smoke=<commit of the checkout this script is in>
#                       (the commit must carry the dashed model pin on every agent file)
#   --only WHICH        vanilla | konductor | both (default both)
#   --claude-bin PATH   the claude binary to use
#   --claude-tools-dir DIR  use the newest <version>/claude under DIR (one of the two is required)
#   --cache DIR         arm build cache (default: inside the scratch directory, so a build is repeated each time)
#   --cargo-target DIR  cargo target directory for the arm build (default: inside the scratch directory)
#   --isolate MODE      passed to bench.js (auto, unshare, sandbox-exec, none; none also passes --allow-unisolated)
#   --budget-usd X      total cap (default 1.5)       --run-budget-usd X   per-run cap (default 0.6)
#   --out DIR           copy the two result directories and the verdict here before cleanup
#   --keep              keep the scratch directory and this run's /tmp/claude-<uid> entries
#   --dry-run           print the plan and the commands; run nothing and read no credentials
#
# Exit codes: 0 all criteria passed, 1 a criterion failed, 2 usage or preflight error (nothing was run).

set -euo pipefail
case $- in *x*) set +x ;; esac
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
HELPER="$SCRIPT_DIR/claude-code-smoke.js"
BENCH_JS="$REPO/bench/runner/bench.js"
SCRATCH_ROOT="${SMOKE_SCRATCH_ROOT:-/var/tmp}"
CLAUDE_TMP_BASE="${SMOKE_CLAUDE_TMP_BASE:-/tmp}"

PROFILE=""
REGION=us-east-1
ACCOUNT=""
ARM_SPEC=""
ONLY=both
CLAUDE_BIN_OPT=""
CLAUDE_TOOLS_DIR_OPT=""
CACHE_DIR=""
CARGO_TARGET=""
ISOLATE=""
BUDGET_USD=1.5
RUN_BUDGET_USD=0.6
OUT_COPY=""
KEEP=0
DRY_RUN=0

SCRATCH=""
SCRATCH_SLUG=""
FAILED=0
UID_NUM="$(id -u)"

say() { printf '[smoke] %s\n' "$*"; }
die() { printf '[smoke] ERROR: %s\n' "$*" >&2; exit 2; }
verdict() { # verdict PASS|FAIL text
  printf '%-5s %s\n' "$1" "$2"
  if [ "$1" = FAIL ]; then FAILED=1; fi
}

usage() { sed -n '2,/^# Exit codes/p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a name}"; shift 2 ;;
    --region) REGION="${2:?--region needs a value}"; shift 2 ;;
    --account) ACCOUNT="${2:?--account needs an id}"; shift 2 ;;
    --arm) ARM_SPEC="${2:?--arm needs a spec}"; shift 2 ;;
    --only) ONLY="${2:?--only needs vanilla, konductor or both}"; shift 2 ;;
    --claude-bin) CLAUDE_BIN_OPT="${2:?--claude-bin needs a path}"; shift 2 ;;
    --claude-tools-dir) CLAUDE_TOOLS_DIR_OPT="${2:?--claude-tools-dir needs a directory}"; shift 2 ;;
    --cache) CACHE_DIR="${2:?--cache needs a directory}"; shift 2 ;;
    --cargo-target) CARGO_TARGET="${2:?--cargo-target needs a directory}"; shift 2 ;;
    --isolate) ISOLATE="${2:?--isolate needs a mode}"; shift 2 ;;
    --budget-usd) BUDGET_USD="${2:?--budget-usd needs a number}"; shift 2 ;;
    --run-budget-usd) RUN_BUDGET_USD="${2:?--run-budget-usd needs a number}"; shift 2 ;;
    --out) OUT_COPY="${2:?--out needs a directory}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

case "$ONLY" in vanilla | konductor | both) ;; *) die "--only takes vanilla, konductor or both" ;; esac
[ -f "$BENCH_JS" ] || die "bench runner not found at $BENCH_JS"
command -v node >/dev/null 2>&1 || die "node is not on PATH"

# ---------------------------------------------------------------- cleanup
# Claude Code names a task directory after the working directory it ran in, with every non-alphanumeric character
# replaced by "-". Every run here works under $SCRATCH, so its directories start with the slug of $SCRATCH; entries
# of any other session in the same temp directory never match.
own_claude_tmp() {
  local d="$CLAUDE_TMP_BASE/claude-$UID_NUM"
  if [ -n "$SCRATCH_SLUG" ] && [ -d "$d" ]; then find "$d" -mindepth 1 -maxdepth 1 -name "${SCRATCH_SLUG}*" 2>/dev/null | LC_ALL=C sort; fi
}

# shellcheck disable=SC2329  # called from cleanup, which runs from the trap
remove_own_claude_tmp() {
  local d="$CLAUDE_TMP_BASE/claude-$UID_NUM" p
  while IFS= read -r p; do
    [ -n "$p" ] && rm -rf -- "$p"
  done < <(own_claude_tmp)
  rmdir -- "$d" 2>/dev/null || true
}

# shellcheck disable=SC2329  # installed with trap
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  set +e
  AWS_ACCESS_KEY_ID="" AWS_SECRET_ACCESS_KEY="" AWS_SESSION_TOKEN=""
  if [ -n "$SCRATCH" ] && [ "$KEEP" -eq 1 ]; then
    say "kept scratch directory: $SCRATCH (and this run's $CLAUDE_TMP_BASE/claude-$UID_NUM entries)"
  elif [ -n "$SCRATCH" ]; then
    remove_own_claude_tmp
    case "$SCRATCH" in "$SCRATCH_ROOT"/claude-code-smoke.??*) [ -d "$SCRATCH" ] && rm -rf -- "$SCRATCH" ;; esac
  fi
  exit "$rc"
}

# ---------------------------------------------------------------- credentials
CRED_ERR=""

# parse_export_output TEXT: the `--format env` output of `aws configure export-credentials`. Exports the three AWS_*
# variables into this shell. Returns 1 with CRED_ERR set (a reason with no values in it) when the output is unusable.
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

load_credentials() {
  if [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ]; then
    say "using the AWS credentials already exported in this shell"
    return 0
  fi
  [ -n "$PROFILE" ] || die "no credentials: pass --profile NAME, or export AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN"
  command -v aws >/dev/null 2>&1 || die "the aws CLI is not on PATH (needed for --profile)"
  local out
  out="$(aws configure export-credentials --profile "$PROFILE" --format env 2>/dev/null)" || die "aws configure export-credentials failed for profile $PROFILE"
  parse_export_output "$out" || die "export-credentials output unusable: $CRED_ERR"
  say "exported credentials from profile $PROFILE (values not shown)"
}

# ---------------------------------------------------------------- plan
bench_args() { # bench_args TASK ARMS OUTDIR
  local args=(run --suite lite --tasks "$1" --arms "$2" --out "$3" --seed 1 --bench-dir "$SCRATCH/bench" --repo-root "$REPO"
    --budget-usd "$BUDGET_USD" --run-budget-usd "$RUN_BUDGET_USD" --aws-region "$REGION" --cache "${CACHE_DIR:-$SCRATCH/cache}"
    --cargo-target "${CARGO_TARGET:-$SCRATCH/cargo-target}" --claude-bin "$CLAUDE_BIN")
  if [ -n "$ISOLATE" ]; then
    args+=(--isolate "$ISOLATE")
    if [ "$ISOLATE" = none ]; then args+=(--allow-unisolated); fi
  fi
  printf '%s\0' "${args[@]}"
}

run_bench() { # run_bench TASK ARMS OUTDIR
  local -a args=()
  while IFS= read -r -d '' a; do args+=("$a"); done < <(bench_args "$1" "$2" "$3")
  say "node bench.js ${args[*]}"
  if [ "$DRY_RUN" -eq 1 ]; then return 0; fi
  (
    cd "$REPO"
    export TMPDIR="$SCRATCH/tmp"
    unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_CONFIG_FILE AWS_SHARED_CREDENTIALS_FILE
    nice -n 10 node "$BENCH_JS" "${args[@]}"
  )
}

# ---------------------------------------------------------------- main
resolve_line="$(node "$HELPER" resolve ${CLAUDE_BIN_OPT:+--claude-bin "$CLAUDE_BIN_OPT"} ${CLAUDE_TOOLS_DIR_OPT:+--claude-tools-dir "$CLAUDE_TOOLS_DIR_OPT"})" || { printf '%s\n' "$resolve_line" >&2; die "cannot use a claude binary: ${resolve_line#FAIL resolve: }"; }
IFS=$'\t' read -r CLAUDE_BIN CLAUDE_VERSION CLAUDE_HOOKS CLAUDE_SHA <<<"$resolve_line"
if [ -z "$ARM_SPEC" ]; then
  git -C "$REPO" rev-parse --verify HEAD >/dev/null 2>&1 || die "no git commit in $REPO; pass --arm SPEC"
  ARM_SPEC="cc-smoke=$(git -C "$REPO" rev-parse HEAD)"
fi
case "$ARM_SPEC" in cc-*) ;; *) die "--arm must start with cc- (a Claude Code arm), got: $ARM_SPEC" ;; esac

say "claude $CLAUDE_VERSION at $CLAUDE_BIN (sha256 $CLAUDE_SHA..., hook events flag: $CLAUDE_HOOKS)"
say "region $REGION, konductor arm $ARM_SPEC, caps \$$RUN_BUDGET_USD per run and \$$BUDGET_USD total, which: $ONLY"

SCRATCH="$(mktemp -d "$SCRATCH_ROOT/claude-code-smoke.XXXXXX")"
trap cleanup EXIT INT TERM
mkdir -p "$SCRATCH/home" "$SCRATCH/tmp"
SCRATCH_SLUG="$(cd "$SCRATCH" && pwd -P | sed 's/[^A-Za-z0-9]/-/g')"
node "$HELPER" make-bench "$SCRATCH/bench" >/dev/null

if [ "$DRY_RUN" -eq 1 ]; then
  say "dry run: no credentials are read and nothing is started"
  if [ "$ONLY" != konductor ]; then run_bench smoke-hello cc-vanilla "$SCRATCH/out-vanilla"; fi
  if [ "$ONLY" != vanilla ]; then run_bench smoke-delegate "$ARM_SPEC" "$SCRATCH/out-konductor"; fi
  say "then: verify both result directories, check /tmp/claude-$UID_NUM and $SCRATCH/tmp for leftovers of this run, clean up"
  exit 0
fi

load_credentials
node "$HELPER" preflight --region "$REGION" --home "$SCRATCH/home" --tmp "$SCRATCH/tmp" ${ACCOUNT:+--account "$ACCOUNT"} || die "credential preflight failed; nothing was run"

BENCH_RC=0
if [ "$ONLY" != konductor ]; then run_bench smoke-hello cc-vanilla "$SCRATCH/out-vanilla" || BENCH_RC=$?; fi
if [ "$ONLY" != vanilla ]; then run_bench smoke-delegate "$ARM_SPEC" "$SCRATCH/out-konductor" || BENCH_RC=$?; fi
if [ "$BENCH_RC" -ne 0 ]; then verdict FAIL "bench.js exited $BENCH_RC (the checks below show what was produced)"; fi

echo
echo "== results =="
verify_args=()
if [ "$ONLY" != konductor ]; then verify_args+=(--vanilla "$SCRATCH/out-vanilla"); fi
if [ "$ONLY" != vanilla ]; then verify_args+=(--konductor "$SCRATCH/out-konductor"); fi
VERIFY_OUT="$(node "$HELPER" verify "${verify_args[@]}")" || FAILED=1
printf '%s\n' "$VERIFY_OUT"

echo
echo "== leftovers =="
NEW_TMP="$(own_claude_tmp)"
if [ -z "$NEW_TMP" ]; then verdict PASS "nothing left for this run in $CLAUDE_TMP_BASE/claude-$UID_NUM"; else verdict FAIL "left for this run in $CLAUDE_TMP_BASE/claude-$UID_NUM (removed on exit): $(printf '%s' "$NEW_TMP" | head -3 | tr '\n' ' ')"; fi
LEFT="$(find "$SCRATCH/tmp" -mindepth 1 -maxdepth 2 2>/dev/null | head -5 | tr '\n' ' ')"
if [ -z "$LEFT" ]; then verdict PASS "nothing left in the run scratch directory"; else verdict FAIL "left in the run scratch directory: $LEFT"; fi
if find "$SCRATCH/home" "$SCRATCH/tmp" \( -name '.aws' -o -name 'credentials' \) 2>/dev/null | grep -q .; then verdict FAIL "a credentials file exists under the scratch directory"; else verdict PASS "no credentials file under the scratch directory"; fi

if [ -n "$OUT_COPY" ]; then
  mkdir -p "$OUT_COPY"
  for d in out-vanilla out-konductor; do [ -d "$SCRATCH/$d" ] && cp -R "$SCRATCH/$d" "$OUT_COPY/$d"; done
  say "results copied to $OUT_COPY"
fi

echo
if [ "$FAILED" -eq 0 ]; then echo "SMOKE: PASS"; else echo "SMOKE: FAIL"; fi
exit "$FAILED"
