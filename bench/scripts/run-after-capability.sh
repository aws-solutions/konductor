#!/usr/bin/env bash
# run-after-capability.sh - unattended chain that runs after the capability study (run-real-pilot.sh) finishes.
#
# PHASES (each logged with timestamps to after-capability.log; the state file records phase results so a rerun resumes)
#   P1 WAIT        poll every 60 s until the capability study is finished: real-pilot.pid gone or not alive AND the last line of
#                  real-pilot.log is a DONE line. A FAILED last line, or a dead pid without DONE, stops the chain. Timeout 36 h.
#   P2 PATCH       optional. With no PATCHES the phase is skipped. Otherwise: study stopped, no bench.js process, `git status
#                  --porcelain bench/` clean in the checkout (on BRANCH when set): `git apply --check` the patches in order, apply
#                  them, run the bench suite (node --test "bench/runner/test/*.test.js") in a scratch HOME. 0 failures required,
#                  else every patch is reverted (`git apply -R`) and the chain stops. On success one local commit per patch, in
#                  order. No push. Files are staged by name. The message comes from <patch>.msg when that file exists, else
#                  from the patch's mail header, else "bench: apply <patch name>".
#   P3 AUTONOMY    optional rerun of the autonomy task dirs (pilot-autonomy-*), for when P2 changed how they are scored. They are
#                  MOVED (never deleted) to $V/incomplete/autonomy-rerun-<UTC>/ and rerun by run-real-pilot.sh --foreground, which
#                  skips every complete dir and so reruns exactly those. Reports askedUser/second-turn counts before and after.
#                  Runs when RERUN_AUTONOMY=1, which is the default once PATCHES is set. Skipped with a log line otherwise, or
#                  when the study has no autonomy dirs.
#   P4 JUDGE       judges every capability task dir with the opencode backend on Bedrock (scoped credentials file, path only, never
#                  read or printed). A cheap `aws bedrock list-foundation-models` call checks the credentials first. If they are
#                  invalid or expire mid-way the chain logs "WAITING FOR CREDENTIALS: re-vend the credentials to <path>" and
#                  polls every 5 min for up to 12 h, then resumes (finished judge calls are cached). Judge errors from unusable
#                  JSON replies are replayed from cache and are only counted. Then builds the free judged reports into
#                  $V/reports-judged/ and writes real-pilot-summary.txt.
#   P5 SKILL BENCH run-skill-bench.sh --foreground (stage 1; SB_SKILLS selects skills, default all tiers). Controls run first
#                  inside it; a failed control stops the chain. Exit with a judge-failed reason or invalid credentials: wait for
#                  credentials and rerun, up to 3 times. Any other failure stops the chain.
#   P6 SUMMARY     after-capability-summary.txt with per-phase results and a final DONE or FAILED at phase N line.
#
# USAGE
#   bash run-after-capability.sh               checks, then self-daemonizes (setsid nohup) and returns
#   bash run-after-capability.sh --foreground  run in this terminal
#   bash run-after-capability.sh --dry-run     print the plan, resolved configuration and read-only checks; changes nothing
#   bash run-after-capability.sh --status      daemon state, phase table, last log lines
#   bash run-after-capability.sh --stop        SIGTERM the daemon; the running child is stopped, the state records where
#   RESUME: rerun the same command. Phases marked done or skipped are not repeated; the interrupted phase restarts.
#   A second instance is refused while one is alive. Nothing is deleted, pushed or force-applied.
#
# CREDENTIALS: CREDS (or AC_CREDS) names the scoped AWS credentials file and has no default. A launch and --dry-run refuse
#   without it. Only the path is used; the contents are never read or printed. The profile inside the file is
#   AWS_PROFILE_NAME (default bench, which is also what bench.js and run-skill-bench.sh use).
#
# FILES (under AC_STATE_DIR, default /tmp/konductor-bench)
#   after-capability.log / .state / .pid / -summary.txt, real-pilot-summary.txt, after-capability-p2-tests.log,
#   real-pilot-autonomy-rerun.log, judge-capability-<dir>.log
#
# ENVIRONMENT OVERRIDES (defaults in brackets)
#   AC_STATE_DIR [/tmp/konductor-bench]        AC_REPO [the checkout this script sits in]   AC_BRANCH [unset: any branch, not detached]
#   AC_CLI_JS [$AC_REPO/bench/runner/bench.js]
#   AC_PATCHES / PATCHES   comma list of patch files for P2, applied in order   [unset: P2 is skipped]
#   AC_RERUN_AUTONOMY / RERUN_AUTONOMY  1 runs P3   [1 when PATCHES is set, else 0]   AC_P3_DEST_PREFIX [autonomy-rerun]
#   AC_AUTONOMY_GLOB [pilot-autonomy-*]  task dir names P3 moves and reruns
#   AC_PILOT_PIDFILE / AC_PILOT_LOG / AC_PILOT_STUDYFILE [$AC_STATE_DIR/real-pilot.{pid,log,study}]
#   AC_PILOT_SCRIPT [run-real-pilot.sh beside this script]  AC_PILOT_PROC_PATTERN [run-real-pilot]
#   AC_SB_SCRIPT [run-skill-bench.sh beside this script]    AC_SB_STATE_DIR [$AC_STATE_DIR]
#   AC_SB_SKILLS / SB_SKILLS  comma list for run-skill-bench --skills   [unset: no filter]
#   AC_SB_RESULTS [auto: the roomiest of AC_RESULTS_CANDIDATES]   AC_RESULTS_CANDIDATES [/var/tmp:/tmp, colon separated]
#   AC_TASKS_PER_SKILL [5]   AC_EXPOSURE_RUNS [auto]
#   AC_ORCH_STUDY [unset]   finished orchestrator study with claude/ and gpt/ cells whose runs add to the exposure data
#   AC_CREDS / CREDS [none, required]   AC_CREDS_EXPIRY_UTC / CREDS_EXPIRY_UTC [unset, a hint only]
#   AC_OC / OC [opencode on PATH]   AC_AWS [aws]   AC_AWS_PROFILE / AWS_PROFILE_NAME [bench]   AC_AWS_REGION / AWS_REGION_NAME [us-east-1]
#   AC_JUDGE_BUDGET_USD [25]   AC_JUDGE_CONCURRENCY [2]
#   AC_POLL_S [60]  AC_WAIT_TIMEOUT_S [129600]  AC_CRED_POLL_S [300]  AC_CRED_TIMEOUT_S [43200]  AC_SB_RETRIES [3]
#   AC_SCRATCH_PARENT [/tmp] (its path must not contain "bench")   AC_BENCH_PROC_PATTERN ['bench/runner/bench\.js']
#   AC_N_ARMS [4]  AC_REPS [5]   (a complete task dir holds N_ARMS x REPS results)   AC_TEST_TIMEOUT_S [3000]   AC_BENCH_GRACE_S [30]
#
# ISOLATION: every bench.js call runs with a scratch HOME and a TMPDIR whose path has no "bench" in it; both are removed.
#   konductor install/update is never run. The checkout is first touched by P2, after the capability study has finished.
#
# EXIT CODES: 0 chain done (or launched), 1 failed or refused, 2 bad usage, 130 stopped.

set -u -o pipefail

SELF=$(readlink -f "${BASH_SOURCE[0]}")
SELF_DIR=$(dirname "$SELF")
DEFAULT_REPO=$(cd "$SELF_DIR/../.." 2>/dev/null && pwd)
STATE_DIR=${AC_STATE_DIR:-/tmp/konductor-bench}
REPO=${AC_REPO:-$DEFAULT_REPO}
BRANCH=${AC_BRANCH:-}
CLI_JS=${AC_CLI_JS:-$REPO/bench/runner/bench.js}
PATCHES=${AC_PATCHES:-${PATCHES:-}}
PATCH_LIST=()
if [ -n "$PATCHES" ]; then
  IFS=, read -r -a PATCH_LIST <<<"$PATCHES"
  for i in "${!PATCH_LIST[@]}"; do PATCH_LIST[i]=$(readlink -f "${PATCH_LIST[i]}"); done
fi
RERUN_AUTONOMY=${AC_RERUN_AUTONOMY:-${RERUN_AUTONOMY:-$([ "${#PATCH_LIST[@]}" -gt 0 ] && echo 1 || echo 0)}}
P3_DEST_PREFIX=${AC_P3_DEST_PREFIX:-autonomy-rerun}
AUTON_GLOB=${AC_AUTONOMY_GLOB:-pilot-autonomy-*}
PILOT_PIDFILE=${AC_PILOT_PIDFILE:-$STATE_DIR/real-pilot.pid}
PILOT_LOG=${AC_PILOT_LOG:-$STATE_DIR/real-pilot.log}
PILOT_STUDYFILE=${AC_PILOT_STUDYFILE:-$STATE_DIR/real-pilot.study}
PILOT_SCRIPT=${AC_PILOT_SCRIPT:-$SELF_DIR/run-real-pilot.sh}
PILOT_PROC_PATTERN=${AC_PILOT_PROC_PATTERN:-run-real-pilot}
SB_SCRIPT=${AC_SB_SCRIPT:-$SELF_DIR/run-skill-bench.sh}
SB_STATE_DIR=${AC_SB_STATE_DIR:-$STATE_DIR}
SB_SKILLS=${AC_SB_SKILLS:-${SB_SKILLS:-}}
SB_RESULTS=${AC_SB_RESULTS:-}
RESULTS_CANDIDATES=${AC_RESULTS_CANDIDATES:-/var/tmp:/tmp}
SB_TASKS=${AC_TASKS_PER_SKILL:-5}
EXPOSURE_OVERRIDE=${AC_EXPOSURE_RUNS:-}
ORCH_STUDY=${AC_ORCH_STUDY:-}
CREDS=${AC_CREDS:-${CREDS:-}}
CREDS_EXPIRY_UTC=${AC_CREDS_EXPIRY_UTC:-${CREDS_EXPIRY_UTC:-}}
OC=${AC_OC:-${OC:-$(command -v opencode || true)}}
AWS_BIN=${AC_AWS:-aws}
AWS_PROFILE_NAME=${AC_AWS_PROFILE:-${AWS_PROFILE_NAME:-bench}}
AWS_REGION_NAME=${AC_AWS_REGION:-${AWS_REGION_NAME:-us-east-1}}
JUDGE_BUDGET=${AC_JUDGE_BUDGET_USD:-25}
JUDGE_CONC=${AC_JUDGE_CONCURRENCY:-2}
POLL_S=${AC_POLL_S:-60}
WAIT_TIMEOUT_S=${AC_WAIT_TIMEOUT_S:-129600}
CRED_POLL_S=${AC_CRED_POLL_S:-300}
CRED_TIMEOUT_S=${AC_CRED_TIMEOUT_S:-43200}
SB_RETRIES=${AC_SB_RETRIES:-3}
SCRATCH_PARENT=${AC_SCRATCH_PARENT:-/tmp}
BENCH_PROC_PATTERN=${AC_BENCH_PROC_PATTERN:-'bench/runner/bench\.js'}
N_ARMS=${AC_N_ARMS:-4}
REPS=${AC_REPS:-5}
TEST_TIMEOUT_S=${AC_TEST_TIMEOUT_S:-3000}
BENCH_GRACE_S=${AC_BENCH_GRACE_S:-30}

LOG=$STATE_DIR/after-capability.log
STATEFILE=$STATE_DIR/after-capability.state
PIDFILE=$STATE_DIR/after-capability.pid
SUMMARY=$STATE_DIR/after-capability-summary.txt
PILOT_SUMMARY=$STATE_DIR/real-pilot-summary.txt
P2_TEST_LOG=$STATE_DIR/after-capability-p2-tests.log
P3_RERUN_LOG=$STATE_DIR/real-pilot-autonomy-rerun.log
SB_LOG=$SB_STATE_DIR/skill-bench.log
SB_STUDYFILE=$SB_STATE_DIR/skill-bench.study

PHASE_NAMES=("" WAIT PATCH AUTONOMY JUDGE SKILLBENCH SUMMARY)

MODE=daemon
for a in "$@"; do
  case "$a" in
    --foreground) MODE=foreground ;;
    --dry-run) MODE=dry-run ;;
    --status) MODE=status ;;
    --stop) MODE=stop ;;
    -h|--help) awk 'NR>1 && /^set -u/ {exit} NR>1 {sub(/^# ?/, ""); print}' "$SELF"; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done
[ "${AC_CHILD:-0}" = 1 ] && MODE=foreground

LOGTO=1
ECHO=0
STOPPING=0
CHILD=""
SLEEP_PID=""
CUR_SH=""
CUR_TD=""
FAIL_REASON=""
PHASE_RESULT=""
P2_APPLIED=0
CRED_NOTE=""
SB_ENV=()
EXPOSURE=""

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
say() {
  local l
  l=$(printf '[%s] %s' "$(ts)" "$*")
  [ "$LOGTO" = 1 ] && printf '%s\n' "$l" >> "$LOG"
  [ "$ECHO" = 1 ] && printf '%s\n' "$l"
  return 0
}
fail_phase() { FAIL_REASON="$*"; return 1; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }
fmt_dur() { local s=${1:-0}; printf '%dh%02dm' $((s / 3600)) $(((s % 3600) / 60)); }
free_gb() { df -Pk "$1" 2>/dev/null | awk 'NR==2{printf "%d", $4/1048576}'; }
strip_nl() { tr '\n\r' '  '; }

# ---------------------------------------------------------------- state file (KEY=VALUE lines)
st_get() { awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); v=$0} END {print v}' "$STATEFILE" 2>/dev/null; }
st_set() {
  local k=$1 v tmp
  v=$(printf '%s' "$2" | strip_nl)
  tmp=$(mktemp "$STATEFILE.XXXXXX") || return 1
  { awk -F= -v k="$k" '$1!=k' "$STATEFILE" 2>/dev/null; printf '%s=%s\n' "$k" "$v"; } > "$tmp"
  mv -f -- "$tmp" "$STATEFILE"
}

# ---------------------------------------------------------------- node helper for JSON work (read-only except where noted)
NODE_HELPER=$(cat <<'JS'
const fs = require('fs'), path = require('path');
const [cmd, ...a] = process.argv.slice(1);
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const resultFiles = (dir) => {
  const out = [];
  for (const arm of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const ad = path.join(dir, arm); let st; try { st = fs.statSync(ad); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const task of fs.readdirSync(ad)) for (const rep of (() => { try { return fs.readdirSync(path.join(ad, task)); } catch { return []; } })()) {
      const f = path.join(ad, task, rep, 'result.json'); if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
};
const walkLedgers = (root, acc = []) => {
  let ents; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) { const p = path.join(root, e.name); if (e.isDirectory()) walkLedgers(p, acc); else if (e.name === 'credit-ledger.jsonl') acc.push(p); }
  return acc;
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
} else if (cmd === 'astats') {       // dirs... -> runs asked second-turn
  let runs = 0, asked = 0, second = 0;
  for (const d of a) for (const f of resultFiles(d)) {
    const r = rd(f); if (!r || !String(r.taskId || '').startsWith('autonomy')) continue;
    runs++; if (r.askedUser === true) asked++; if ((r.turns || 0) >= 2) second++;
  }
  console.log('runs=' + runs + ' askedUser=' + asked + ' secondTurn=' + second);
} else if (cmd === 'credits') {      // dirs... -> "runCredits runs judgeUsd judgeCalls"
  let cr = 0, runs = 0, usd = 0, jc = 0;
  for (const d of a) for (const f of walkLedgers(d)) for (const e of lines(f)) {
    if (e.kind === 'run') { runs++; cr += Number(e.charged ?? e.credits ?? 0) || 0; }
    else if (e.kind === 'judge' && !e.cached && typeof e.usd === 'number') { usd += e.usd; jc++; }
  }
  console.log(cr.toFixed(2) + ' ' + runs + ' ' + usd.toFixed(4) + ' ' + jc);
} else if (cmd === 'judgeinfo') {    // judgments.json -> "errors credErrors budgetSkipped spentUsd"
  const j = rd(a[0]); if (!j) { console.log('unreadable 0 0 0'); process.exit(0); }
  const recs = [...(j.rubric || []), ...(j.pairwise || []), ...(j.graded || [])];
  const errs = recs.filter((r) => r.judgeError);
  const cred = errs.filter((r) => /credential|expired|ExpiredToken|security token|UnrecognizedClient|InvalidClientTokenId|AccessDenied|not authorized/i.test(String(r.judgeError))).length;
  const bud = errs.filter((r) => /budget reached/.test(String(r.judgeError))).length;
  console.log(errs.length + ' ' + cred + ' ' + bud + ' ' + (typeof j.spentUsd === 'number' ? j.spentUsd.toFixed(4) : 0));
} else if (cmd === 'judgebackend') {
  const j = rd(a[0]); console.log(j ? String(j.backend || 'kiro') : 'none');
} else if (cmd === 'decisions') {    // decisions.json -> counts and list
  const j = rd(a[0]); if (!j) { console.log('unreadable'); process.exit(0); }
  const order = ['DELETE', 'PRUNE', 'KEEP', 'NEEDS DATA']; const ds = j.decisions || [];
  console.log(order.map((k) => k + '=' + ds.filter((d) => d.decision === k).length).join(' '));
  for (const d of ds.slice().sort((x, y) => order.indexOf(x.decision) - order.indexOf(y.decision) || String(x.name).localeCompare(y.name))) console.log('  ' + d.name + ': ' + d.decision + ' (' + d.confidence + ')');
  console.log('controls: ' + (j.controls && j.controls.trusted === true ? 'passed' : j.controls && j.controls.trusted === false ? 'FAILED' : 'not checked'));
} else if (cmd === 'psummary') {     // V RJ -> the capability judging summary on stdout
  const [V, RJ] = a; const out = []; const p = (s = '') => out.push(s);
  const usd = (n) => (typeof n === 'number' ? '$' + n.toFixed(4) : 'n/a');
  p('Capability study judging summary, generated ' + new Date().toISOString()); p('Study: ' + V); p();
  p('Judge spend and errors per task dir');
  let tot = 0;
  const dirs = fs.readdirSync(V).filter((n) => /^(real|pilot)-/.test(n) && fs.existsSync(path.join(V, n, 'summary.json'))).sort();
  for (const n of dirs) {
    const j = rd(path.join(V, n, 'judgments.json'));
    if (!j) { p('- ' + n + ': judgments.json missing, not judged'); continue; }
    const recs = [...(j.rubric || []), ...(j.pairwise || []), ...(j.graded || [])];
    const errs = recs.filter((r) => r.judgeError); const pf = recs.reduce((s, r) => s + (typeof r.parseFailures === 'number' ? r.parseFailures : 0), 0);
    const inv = j.invocations || []; const calls = inv.reduce((s, x) => s + (x.calls || 0), 0); const cached = inv.reduce((s, x) => s + (x.cachedCalls || 0), 0);
    if (typeof j.spentUsd === 'number') tot += j.spentUsd;
    p('- ' + n + ': spent ' + usd(j.spentUsd) + ' over ' + inv.length + ' invocation(s), calls ' + calls + ' (' + cached + ' cached), parse failures ' + pf + ', judge errors ' + errs.length + ', not judged ' + (j.notJudged || []).length);
  }
  p('Total judge spend (sum of the per-dir figures): ' + usd(tot)); p();
  p('Orchestrator pass rule (cell | arm | call)');
  const pass = rd(path.join(RJ, 'pass', 'orchestrator-pass.json'));
  if (!pass) p('    report missing: pass/orchestrator-pass.json');
  else for (const c of pass.cells || []) for (const x of c.arms || []) {
    const why = x.aaRepeatOf ? 'A/A repeat of ' + x.aaRepeatOf : (x.reasons || []).slice(0, 2).join('; ');
    p('- ' + (c.key || (c.harnessLabel + ' / ' + c.model)) + ' | ' + x.label + ' | ' + x.call + (why ? ' | ' + why : ''));
  }
  p(); p('Platform verdict (arm | verdict)');
  const v = rd(path.join(RJ, 'platform', 'verdict.json'));
  if (!v) p('    report missing: platform/verdict.json'); else for (const x of v.arms || []) p('- ' + x.label + ' | ' + x.verdict + (x.aaRepeatOf ? ' (A/A repeat of ' + x.aaRepeatOf + ')' : ''));
  p(); p('Reports');
  if (fs.existsSync(RJ)) for (const d of fs.readdirSync(RJ).sort()) { const f = path.join(RJ, d); if (fs.statSync(f).isDirectory()) p('- ' + f + '/'); }
  console.log(out.join('\n'));
}
JS
)
hj() { node -e "$NODE_HELPER" "$@"; }

# ---------------------------------------------------------------- scratch HOME and TMPDIR around every node call
drop_scratch() {
  local d
  for d in "$CUR_SH" "$CUR_TD"; do
    case "$d" in "$SCRATCH_PARENT"/ac-home.*|"$SCRATCH_PARENT"/ac-tmp.*) rm -rf -- "$d" ;; esac
  done
  CUR_SH=""; CUR_TD=""
}
new_scratch() {
  CUR_SH=$(mktemp -d "$SCRATCH_PARENT/ac-home.XXXXXX") || return 1
  CUR_TD=$(mktemp -d "$SCRATCH_PARENT/ac-tmp.XXXXXX") || return 1
}

# ---------------------------------------------------------------- signals, naps and waiting for a child
on_term() {
  STOPPING=1
  say "signal received: stopping (the current child is told to stop; rerun this script to resume)"
  [ -n "$CHILD" ] && kill -TERM "$CHILD" 2>/dev/null
  [ -n "$SLEEP_PID" ] && kill -TERM "$SLEEP_PID" 2>/dev/null
  return 0
}
wait_child() { # waits for $CHILD; returns its exit status
  local rc
  while :; do
    wait "$CHILD"; rc=$?
    alive "$CHILD" || break
  done
  CHILD=""
  return "$rc"
}
nap() { # nap <seconds>; interruptible
  sleep "$1" & SLEEP_PID=$!
  wait "$SLEEP_PID" 2>/dev/null
  SLEEP_PID=""
  return 0
}

# node_run <outfile> <bench.js args...>: bench.js with a scratch HOME and a TMPDIR without "bench"; output appended to outfile
node_run() {
  local out=$1 rc; shift
  new_scratch || { say "cannot create scratch dirs under $SCRATCH_PARENT"; return 99; }
  mkdir -p "$(dirname "$out")" 2>/dev/null
  ( cd "$REPO" && exec env -u BENCH_JUDGE_CMD HOME="$CUR_SH" TMPDIR="$CUR_TD" node "$CLI_JS" "$@" ) >> "$out" 2>&1 < /dev/null &
  CHILD=$!
  wait_child; rc=$?
  drop_scratch
  return "$rc"
}

# ---------------------------------------------------------------- credentials (the file path only; contents never read)
creds_ok() {
  local out rc
  CRED_NOTE=""
  if [ -z "$CREDS" ]; then CRED_NOTE="CREDS is not set"; return 1; fi
  if [ ! -s "$CREDS" ] || [ ! -r "$CREDS" ]; then CRED_NOTE="credentials file missing, empty or unreadable"; return 1; fi
  out=$(env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN -u AWS_PROFILE \
        AWS_SHARED_CREDENTIALS_FILE="$CREDS" AWS_CONFIG_FILE=/dev/null AWS_PROFILE="$AWS_PROFILE_NAME" \
        timeout 90 "$AWS_BIN" bedrock list-foundation-models --region "$AWS_REGION_NAME" --query 'length(modelSummaries)' --output text 2>&1)
  rc=$?
  if [ "$rc" -eq 0 ]; then return 0; fi
  if printf '%s' "$out" | grep -qiE 'AccessDenied|not authorized|UnauthorizedOperation'; then
    CRED_NOTE="listing models is denied for the scoped session (not treated as expired)"; return 0
  fi
  CRED_NOTE=$(printf '%s' "$out" | grep -oE 'An error occurred \([A-Za-z]+\)' | head -1)
  [ -n "$CRED_NOTE" ] || CRED_NOTE="aws call failed with exit status $rc"
  return 1
}
wait_for_credentials() { # <what needs them>; 0 valid, 1 timeout, 130 stopped
  creds_ok && return 0
  local t0 n=0
  t0=$(date +%s)
  st_set WAITING_FOR_CREDENTIALS "$1 since $(ts)"
  say "WAITING FOR CREDENTIALS: re-vend the credentials to $CREDS  (needed for $1; last check: $CRED_NOTE; polling every ${CRED_POLL_S}s for up to $((CRED_TIMEOUT_S / 3600)) h)"
  while :; do
    nap "$CRED_POLL_S"
    [ "$STOPPING" = 1 ] && return 130
    n=$((n + 1))
    if creds_ok; then
      say "credentials are valid again after $(fmt_dur $(($(date +%s) - t0)))"
      st_set WAITING_FOR_CREDENTIALS none
      return 0
    fi
    if [ $(($(date +%s) - t0)) -ge "$CRED_TIMEOUT_S" ]; then
      st_set WAITING_FOR_CREDENTIALS none
      say "gave up waiting for credentials after $(fmt_dur "$CRED_TIMEOUT_S")"
      return 1
    fi
    [ $((n % 6)) -eq 0 ] && say "WAITING FOR CREDENTIALS: re-vend the credentials to $CREDS  (needed for $1; waited $(fmt_dur $(($(date +%s) - t0))); last check: $CRED_NOTE)"
  done
}

# ---------------------------------------------------------------- credit and spend log after each phase
study_dir() { [ -s "$PILOT_STUDYFILE" ] && [ -d "$(cat "$PILOT_STUDYFILE")" ] && cat "$PILOT_STUDYFILE"; }
log_credits() {
  local V cr runs usd jc scr sbv scu
  V=$(study_dir) || return 0
  read -r cr runs usd jc < <(hj credits "$V" 2>/dev/null || echo "0 0 0 0")
  say "credits so far (no cap set): capability study ${cr:-0} credits over ${runs:-0} runs; capability judge USD ${usd:-0} over ${jc:-0} live calls"
  if [ -s "$SB_STUDYFILE" ]; then
    sbv=$(cat "$SB_STUDYFILE")
    read -r scr runs scu jc < <(hj credits "$sbv" 2>/dev/null || echo "0 0 0 0")
    say "credits so far: skill bench ${scr:-0} credits over ${runs:-0} runs; skill bench judge USD ${scu:-0} over ${jc:-0} live calls"
  fi
}

# ---------------------------------------------------------------- helpers over the capability study dirs
cap_dirs() { # prints task dirs (real-* and pilot-*) of the study that hold a summary.json, sorted
  local V=$1 d
  for d in "$V"/real-* "$V"/pilot-*; do
    [ -d "$d" ] && [ -f "$d/summary.json" ] && printf '%s\n' "$d"
  done | sort
}
cap_dirs_kind() { # <study> <real|pilot|autonomy>: by directory name, not by path
  local d
  for d in $(cap_dirs "$1"); do
    # shellcheck disable=SC2254  # AUTON_GLOB is meant as a glob
    case "$2:$(basename "$d")" in real:real-*|pilot:pilot-*|autonomy:$AUTON_GLOB) printf '%s\n' "$d" ;; esac
  done
}
join_csv() { local IFS=,; echo "$*"; }
bench_procs() { pgrep -af "$BENCH_PROC_PATTERN" 2>/dev/null | grep -v " pgrep " | grep -v "^$$ " || true; }

# pilot_state: sets PS_ALIVE (0/1), PS_LAST (last non-empty log line)
pilot_state() {
  local pid
  PS_ALIVE=0
  pid=$(cat "$PILOT_PIDFILE" 2>/dev/null || true)
  if alive "$pid" && tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q -- "$PILOT_PROC_PATTERN"; then PS_ALIVE=1; fi
  PS_PID=$pid
  PS_LAST=$(tail -n 30 "$PILOT_LOG" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -n 1)
}
is_done_line() { printf '%s' "$1" | grep -qE '^\[[^]]*\] DONE:'; }
is_failed_line() { printf '%s' "$1" | grep -qE '^\[[^]]*\] FAILED'; }

# ================================================================ P1 WAIT
p1_wait() {
  local t0 n=0
  t0=$(date +%s)
  say "P1: waiting for the capability study (pid file $PILOT_PIDFILE, log $PILOT_LOG), polling every ${POLL_S}s, timeout $(fmt_dur "$WAIT_TIMEOUT_S")"
  while :; do
    [ "$STOPPING" = 1 ] && return 130
    pilot_state
    if [ "$PS_ALIVE" = 0 ]; then
      if ! is_done_line "$PS_LAST" && ! is_failed_line "$PS_LAST"; then
        for _ in 1 2 3; do # the DONE line is written before the pid file is removed; give a late flush a moment
          nap 10; [ "$STOPPING" = 1 ] && return 130
          pilot_state
          if is_done_line "$PS_LAST" || is_failed_line "$PS_LAST" || [ "$PS_ALIVE" = 1 ]; then break; fi
        done
      fi
      if [ "$PS_ALIVE" = 0 ]; then
        if is_done_line "$PS_LAST"; then
          say "P1: the capability study is finished. Last log line: $PS_LAST"
          return 0
        fi
        if is_failed_line "$PS_LAST"; then
          fail_phase "the capability study ended FAILED: $PS_LAST. Chain stopped before touching anything. Fix the cause, run 'bash $PILOT_SCRIPT' to resume the study, then rerun 'bash $SELF' (it resumes at P1)."
          return 1
        fi
        fail_phase "the capability study is not running (pid '${PS_PID:-none}' gone or not alive) and its log does not end with a DONE line. Last log line: ${PS_LAST:-(empty)}. Chain stopped. Check 'bash $PILOT_SCRIPT --status', resume the study with 'bash $PILOT_SCRIPT', then rerun 'bash $SELF'."
        return 1
      fi
    fi
    if [ $(($(date +%s) - t0)) -ge "$WAIT_TIMEOUT_S" ]; then
      fail_phase "waited $(fmt_dur "$WAIT_TIMEOUT_S") and the capability study has not finished (pid $PS_PID, last log line: ${PS_LAST:-(empty)}). Chain stopped; rerun 'bash $SELF' to wait again."
      return 1
    fi
    n=$((n + 1))
    if [ $((n % 30)) -eq 1 ]; then say "P1: still waiting; study running (pid $PS_PID), waited $(fmt_dur $(($(date +%s) - t0))). Last log line: ${PS_LAST:-(empty)}"; fi
    nap "$POLL_S"
  done
}

# ================================================================ P2 PATCH
patch_files() { git apply --numstat "$1" | awk -F'\t' '{print $3}'; }
patch_name() { basename "$1"; }
revert_check() { # every patch reverts cleanly, newest first
  local i
  for ((i = ${#PATCH_LIST[@]} - 1; i >= 0; i--)); do ( cd "$REPO" && git apply -R --check "${PATCH_LIST[i]}" ) >/dev/null 2>&1 || return 1; done
}
revert_all() { # git apply -R, newest first
  local i
  for ((i = ${#PATCH_LIST[@]} - 1; i >= 0; i--)); do ( cd "$REPO" && git apply -R "${PATCH_LIST[i]}" ) || return 1; done
}
p2_rollback() {
  [ "$P2_APPLIED" = 1 ] || return 0
  say "P2: ROLLBACK: reverting every patch with git apply -R to restore the clean tree"
  if revert_all >> "$LOG" 2>&1; then
    P2_APPLIED=0
    if [ -z "$(git -C "$REPO" status --porcelain bench/)" ]; then say "P2: rollback complete: bench/ is clean"; else say "P2: WARNING rollback finished but bench/ is not clean: $(git -C "$REPO" status --porcelain bench/ | head -5 | strip_nl)"; fi
  else
    say "P2: WARNING: git apply -R failed; the tree may still hold the patches. Inspect with: git -C $REPO status --porcelain bench/"
  fi
}
commit_message() { # <patch> <outfile>: <patch>.msg, else the mail header, else a plain line
  local patch=$1 out=$2 md
  if [ -f "$patch.msg" ]; then cp -- "$patch.msg" "$out"; return 0; fi
  md=$(mktemp -d "$SCRATCH_PARENT/ac-tmp.mi.XXXXXX") || return 1
  git mailinfo "$md/body" "$md/patch" < "$patch" > "$md/info" 2>/dev/null
  if [ -n "$(sed -n 's/^Subject: //p' "$md/info" | head -1)" ]; then
    { sed -n 's/^Subject: //p' "$md/info" | head -1; echo; cat "$md/body"; } > "$out"
  else
    printf 'bench: apply %s\n' "$(patch_name "$patch")" > "$out"
  fi
  rm -rf -- "$md"
}
message_marker() { # prints the first public-hygiene marker found in the files, if the checkout has the scanner
  node -e '
    const fs = require("fs"), path = require("path");
    let m; try { m = require(path.join(process.argv[1], "bench/cap/public.js")); } catch { process.exit(3); }
    for (const f of process.argv.slice(2)) { const h = m.findMarker(fs.readFileSync(f, "utf8")); if (h) { console.log(h.marker); process.exit(0); } }
  ' "$REPO" "$@"
}
p2_patch() {
  local br head want got mdir rc total pass fail skipped n info i p files marker
  if [ "${#PATCH_LIST[@]}" -eq 0 ]; then
    say "P2: SKIPPED: no patches given (set PATCHES to a comma list of patch files to run this phase)"
    st_set P2_note "no patches given"
    PHASE_RESULT=skipped
    return 0
  fi
  if ! git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then fail_phase "not a git repository: $REPO"; return 1; fi
  for p in "${PATCH_LIST[@]}"; do [ -f "$p" ] || { fail_phase "patch file missing: $p"; return 1; }; done
  # gate 1: the study is stopped and nothing runs bench.js (a short grace for the study's last child to exit)
  pilot_state
  if [ "$PS_ALIVE" = 1 ]; then fail_phase "the capability study is still running (pid $PS_PID); refusing to touch the checkout"; return 1; fi
  for n in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(bench_procs)" ] && break
    [ "$n" = 1 ] && say "P2: a bench.js process is still running; waiting up to 5 min for it to exit: $(bench_procs | head -2 | strip_nl)"
    nap "$BENCH_GRACE_S"; [ "$STOPPING" = 1 ] && return 130
  done
  if [ -n "$(bench_procs)" ]; then fail_phase "a bench.js process is running: $(bench_procs | head -2 | strip_nl). Not touching the checkout."; return 1; fi
  br=$(git -C "$REPO" branch --show-current)
  if [ -z "$br" ]; then fail_phase "the checkout is on a detached HEAD; commits need a branch"; return 1; fi
  if [ -n "$BRANCH" ] && [ "$br" != "$BRANCH" ]; then fail_phase "the checkout is on branch '$br', expected $BRANCH"; return 1; fi
  head=$(git -C "$REPO" rev-parse --short=8 HEAD)
  # a previous run killed between apply and commit leaves exactly the patches uncommitted: revert them first
  if [ -n "$(git -C "$REPO" status --porcelain bench/)" ]; then
    if revert_check; then
      say "P2: bench/ holds the patches uncommitted (an interrupted earlier run); reverting them to restore a clean tree, then redoing the phase"
      P2_APPLIED=1; p2_rollback
    fi
  fi
  if [ -n "$(git -C "$REPO" status --porcelain bench/)" ]; then
    fail_phase "bench/ is not clean on $br ($(git -C "$REPO" status --porcelain bench/ | head -5 | strip_nl)). Chain stopped; nothing was applied."
    return 1
  fi
  say "P2: checkout $REPO on $br at $head, bench/ clean, study stopped, no bench.js process"
  # gate 2: the patches apply, in order, to a clean tree
  if ! ( cd "$REPO" && for p in "${PATCH_LIST[@]}"; do git apply --check "$p" || exit 1; done ) >> "$LOG" 2>&1; then
    fail_phase "git apply --check failed for a patch on $head (see $LOG). Nothing was applied."
    return 1
  fi
  say "P2: git apply --check passed for: $(for p in "${PATCH_LIST[@]}"; do patch_name "$p"; done | strip_nl)"
  P2_APPLIED=1
  for p in "${PATCH_LIST[@]}"; do
    if ! ( cd "$REPO" && git apply "$p" ) >> "$LOG" 2>&1; then
      p2_rollback
      fail_phase "applying $(patch_name "$p") failed after the check passed (see $LOG); rolled back"
      return 1
    fi
  done
  st_set P2_applied "$(ts) on $head"
  say "P2: patches applied (uncommitted). Running the bench suite in a scratch HOME (log $P2_TEST_LOG)"
  : > "$P2_TEST_LOG"
  new_scratch || { p2_rollback; fail_phase "cannot create scratch dirs"; return 1; }
  ( cd "$REPO" && exec env -u BENCH_JUDGE_CMD HOME="$CUR_SH" TMPDIR="$CUR_TD" timeout -s TERM -k 60 "$TEST_TIMEOUT_S" node --test "bench/runner/test/*.test.js" ) >> "$P2_TEST_LOG" 2>&1 < /dev/null &
  CHILD=$!
  wait_child; rc=$?
  drop_scratch
  if [ "$STOPPING" = 1 ]; then p2_rollback; return 130; fi
  total=$(grep -aE '^(# |ℹ )tests [0-9]+' "$P2_TEST_LOG" | tail -1 | awk '{print $3}')
  pass=$(grep -aE '^(# |ℹ )pass [0-9]+' "$P2_TEST_LOG" | tail -1 | awk '{print $3}')
  fail=$(grep -aE '^(# |ℹ )fail [0-9]+' "$P2_TEST_LOG" | tail -1 | awk '{print $3}')
  skipped=$(grep -aE '^(# |ℹ )skipped [0-9]+' "$P2_TEST_LOG" | tail -1 | awk '{print $3}')
  info="tests ${total:-?}, pass ${pass:-?}, fail ${fail:-?}, skipped ${skipped:-?}, exit $rc"
  st_set P2_tests "$info"
  say "P2: bench suite result: $info"
  if [ "$rc" != 0 ] || [ -z "${total:-}" ] || [ "${fail:-x}" != 0 ] || [ "${total:-0}" -le 0 ]; then
    p2_rollback
    fail_phase "the bench suite did not pass ($info; log $P2_TEST_LOG). Every patch was reverted; the checkout is clean again."
    return 1
  fi
  # one local commit per patch, in order, files staged by name
  mdir=$(mktemp -d "$SCRATCH_PARENT/ac-tmp.msg.XXXXXX") || { p2_rollback; fail_phase "cannot create a scratch dir for the commit messages"; return 1; }
  for i in "${!PATCH_LIST[@]}"; do commit_message "${PATCH_LIST[i]}" "$mdir/msg$((i + 1))" || { rm -rf -- "$mdir"; p2_rollback; fail_phase "cannot read the mail header of ${PATCH_LIST[i]}"; return 1; }; done
  marker=$(message_marker "$mdir"/msg*); rc=$?
  if [ "$rc" = 3 ]; then say "P2: note: bench/cap/public.js not found in $REPO; the commit message hygiene check is skipped"
  elif [ -n "$marker" ]; then
    rm -rf -- "$mdir"; p2_rollback
    fail_phase "a commit message matches the public-hygiene marker '$marker'; patches reverted"
    return 1
  fi
  for i in "${!PATCH_LIST[@]}"; do
    p=${PATCH_LIST[i]}; files=$(patch_files "$p")
    # shellcheck disable=SC2086
    if ! ( cd "$REPO" && git add -- $files ); then
      if [ "$i" = 0 ]; then p2_rollback; fi
      rm -rf -- "$mdir"; fail_phase "git add failed for $(patch_name "$p")"; return 1
    fi
    want=$(printf '%s\n' $files | sort); got=$(git -C "$REPO" diff --cached --name-only | sort)
    if [ "$want" != "$got" ]; then
      git -C "$REPO" restore --staged -- . ; [ "$i" = 0 ] && p2_rollback
      rm -rf -- "$mdir"; fail_phase "the staged files differ from the files of $(patch_name "$p"); unstaged"
      return 1
    fi
    if ! git -C "$REPO" commit -q -F "$mdir/msg$((i + 1))" >> "$LOG" 2>&1; then
      git -C "$REPO" restore --staged -- . ; [ "$i" = 0 ] && p2_rollback
      rm -rf -- "$mdir"; fail_phase "git commit failed for $(patch_name "$p") (see $LOG); unstaged"
      return 1
    fi
    st_set "P2_commit$((i + 1))" "$(git -C "$REPO" rev-parse --short=8 HEAD) $(git -C "$REPO" log -1 --format=%s)"
    say "P2: commit $((i + 1)): $(st_get "P2_commit$((i + 1))")"
  done
  P2_APPLIED=0
  rm -rf -- "$mdir"
  say "P2: done: $info; ${#PATCH_LIST[@]} local commit(s), nothing pushed; tree status for bench/: '$(git -C "$REPO" status --porcelain bench/ | head -3 | strip_nl)'"
  return 0
}

# ================================================================ P3 AUTONOMY RERUN
p3_autonomy() {
  local V dirs d name dest utc before after bad rc n_total ok_n names
  if [ "$RERUN_AUTONOMY" != 1 ]; then
    say "P3: SKIPPED: RERUN_AUTONOMY is not 1 (it defaults to 1 only when PATCHES is set)"
    st_set P3_note "rerun not requested"
    PHASE_RESULT=skipped
    return 0
  fi
  V=$(study_dir) || { fail_phase "no study dir ($PILOT_STUDYFILE)"; return 1; }
  dest=$(st_get P3_dest)
  mapfile -t dirs < <(cap_dirs_kind "$V" autonomy)
  if [ "${#dirs[@]}" -eq 0 ] && [ -z "$dest" ]; then
    say "P3: SKIPPED: the study has no autonomy task dirs under $V"
    PHASE_RESULT=skipped
    return 0
  fi
  pilot_state
  [ "$PS_ALIVE" = 1 ] && { fail_phase "the capability study is still running (pid $PS_PID)"; return 1; }
  [ -z "$(bench_procs)" ] || { fail_phase "a bench.js process is running: $(bench_procs | head -2 | strip_nl)"; return 1; }
  # every other task dir must already be complete, so the rerun touches exactly the autonomy dirs
  bad=""
  for d in $(cap_dirs "$V"); do
    # shellcheck disable=SC2254
    case "$(basename "$d")" in $AUTON_GLOB) continue ;; esac
    [ "$(hj complete "$d" "$N_ARMS" "$REPS")" = complete ] || bad="$bad $(basename "$d")($(hj complete "$d" "$N_ARMS" "$REPS"))"
  done
  if [ -n "$bad" ]; then fail_phase "non-autonomy task dirs are not complete:$bad. Rerunning would redo them too. Chain stopped; nothing moved."; return 1; fi
  if [ -z "$dest" ]; then
    utc=$(date -u +%Y%m%dT%H%M%SZ)
    dest=$V/incomplete/$P3_DEST_PREFIX-$utc
    names=""
    for d in "${dirs[@]}"; do names="$names $(basename "$d")"; done
    st_set P3_dest "$dest"; st_set P3_names "${names# }"; st_set P3_total_dirs "$(cap_dirs "$V" | wc -l)"; st_set P3_moved no
  fi
  n_total=$(st_get P3_total_dirs)
  if [ "$(st_get P3_moved)" != yes ]; then
    mkdir -p "$dest" || { fail_phase "cannot create $dest"; return 1; }
    for name in $(st_get P3_names); do
      [ -d "$V/$name" ] || continue
      [ -e "$dest/$name" ] && { fail_phase "$dest/$name already exists; not overwriting"; return 1; }
      mv -- "$V/$name" "$dest/$name" || { fail_phase "move of $V/$name failed"; return 1; }
      say "P3: moved $name to $dest/"
    done
    if [ -d "$V/reports-prejudge" ] && [ ! -e "$dest/reports-prejudge" ]; then
      mv -- "$V/reports-prejudge" "$dest/reports-prejudge" && say "P3: moved the pre-rerun reports-prejudge to $dest/ (the rerun regenerates it)"
    fi
    st_set P3_moved yes
  fi
  before=$(st_get P3_before)
  if [ -z "$before" ]; then
    # shellcheck disable=SC2086
    before=$(hj astats "$dest"/$AUTON_GLOB)
    st_set P3_before "$before"
  fi
  say "P3: autonomy results BEFORE the rerun ($dest): $before"
  say "P3: rerunning the autonomy tasks through $PILOT_SCRIPT --foreground (it skips complete dirs); output: $P3_RERUN_LOG"
  ( cd "$STATE_DIR" && exec env -u RP_CHILD STATE_DIR="$STATE_DIR" REPO="$REPO" CLI_JS="$CLI_JS" bash "$PILOT_SCRIPT" --foreground ) >> "$P3_RERUN_LOG" 2>&1 < /dev/null &
  CHILD=$!
  wait_child; rc=$?
  [ "$STOPPING" = 1 ] && return 130
  say "P3: run-real-pilot exited $rc; last lines: $(tail -n 3 "$P3_RERUN_LOG" | strip_nl)"
  if [ "$rc" != 0 ] || ! tail -n 30 "$P3_RERUN_LOG" | grep -qE '^\[[^]]*\] DONE:'; then
    fail_phase "the autonomy rerun did not finish with DONE (exit $rc). See $P3_RERUN_LOG. The old dirs are in $dest. Rerun 'bash $SELF' to resume (run-real-pilot resumes task by task)."
    return 1
  fi
  ok_n=0
  for d in $(cap_dirs "$V"); do [ "$(hj complete "$d" "$N_ARMS" "$REPS")" = complete ] && ok_n=$((ok_n + 1)); done
  if [ "$ok_n" != "$n_total" ]; then fail_phase "after the rerun $ok_n of $n_total task dirs are complete (expected all). See $P3_RERUN_LOG"; return 1; fi
  # shellcheck disable=SC2086
  after=$(hj astats "$V"/$AUTON_GLOB)
  st_set P3_after "$after"
  say "P3: BEFORE the rerun ($dest): $before"
  say "P3: AFTER  the rerun ($V): $after"
  return 0
}

# ================================================================ P4 JUDGE CAPABILITY
judge_args() { # judge_args <dir>
  printf '%s\n' judge --run "$1" --judge-backend opencode --opencode-bin "$OC" --aws-creds-file "$CREDS" --aws-profile "$AWS_PROFILE_NAME" \
    --aws-region "$AWS_REGION_NAME" --profile detailed --concurrency "$JUDGE_CONC" --budget-usd "$JUDGE_BUDGET"
}
p4_judge_one() { # <dir>; 0 ok, 1 fail, 130 stopped
  local d=$1 name attempt=0 rc info errs cerrs bud spent be jl
  name=$(basename "$d"); jl=$STATE_DIR/judge-capability-$name.log
  if [ -f "$d/judgments.json" ]; then
    be=$(hj judgebackend "$d/judgments.json")
    if [ "$be" != opencode ]; then fail_phase "$d/judgments.json was written by the '$be' backend; one backend per study. Move it aside by hand to rejudge."; return 1; fi
  fi
  while :; do
    attempt=$((attempt + 1))
    wait_for_credentials "judging $name" || { rc=$?; [ "$rc" = 130 ] && return 130; fail_phase "no valid credentials for judging $name (waited $(fmt_dur "$CRED_TIMEOUT_S")); rerun 'bash $SELF' after re-vending"; return 1; }
    say "P4: judging $name (attempt $attempt, budget cap \$$JUDGE_BUDGET, log $jl)"
    mapfile -t jargs < <(judge_args "$d")
    node_run "$jl" "${jargs[@]}"; rc=$?
    [ "$STOPPING" = 1 ] && return 130
    read -r errs cerrs bud spent < <(hj judgeinfo "$d/judgments.json")
    say "P4: $name: judge exit $rc, judge errors ${errs}, of which credential errors ${cerrs}, budget-skipped ${bud}, spent \$${spent}"
    if [ "$rc" = 0 ] && [ "$errs" = unreadable ]; then
      fail_phase "judging $name exited 0 but $d/judgments.json is missing or unreadable; see $jl"; return 1
    fi
    if [ "$rc" = 3 ] || [ "${bud:-0}" != 0 ]; then
      fail_phase "judging $name hit the \$$JUDGE_BUDGET budget guard (exit $rc, $bud skipped). Rerun with AC_JUDGE_BUDGET_USD=<higher> bash $SELF (finished calls are cached)."
      return 1
    fi
    if [ "$rc" != 0 ]; then
      if creds_ok; then fail_phase "judging $name exited $rc with valid credentials; see $jl"; return 1; fi
      [ "$attempt" -ge 5 ] && { fail_phase "judging $name failed $attempt times on credentials; see $jl"; return 1; }
      say "P4: $name stopped on credentials; waiting, then resuming from the cache"
      continue
    fi
    if [ "${cerrs:-0}" != 0 ]; then
      [ "$attempt" -ge 5 ] && { fail_phase "judging $name still has $cerrs credential errors after $attempt attempts; see $jl"; return 1; }
      say "P4: $name has $cerrs credential-rejected calls (not cached); rerunning after a credentials check"
      creds_ok || true
      [ -n "$CRED_NOTE" ] && say "P4: credential check: $CRED_NOTE"
      continue
    fi
    st_set "P4_dir_$name" "exit $rc errors $errs spent \$$spent"
    return 0
  done
}
p4_reports() {
  local V=$1 RJ=$2 real pilot all name args warn=0 rc
  real=$(cap_dirs_kind "$V" real | paste -sd, -); pilot=$(cap_dirs_kind "$V" pilot | paste -sd, -); all=$(cap_dirs "$V" | paste -sd, -)
  mkdir -p "$RJ" || { say "P4: cannot create $RJ"; return 1; }
  local -a specs=()
  [ -n "$real" ] && specs+=("report-real|report --run $real --profile detailed --baseline vanilla --out $RJ/report-real")
  [ -n "$pilot" ] && specs+=("report-pilot|report --run $pilot --profile detailed --baseline vanilla --out $RJ/report-pilot")
  specs+=("pass|report --run $all --verdict orchestrator-pass --baseline vanilla --out $RJ/pass")
  specs+=("platform|report --run $all --verdict platform --baseline vanilla --out $RJ/platform")
  [ -n "$real" ] && specs+=("contrast-real|contrast --run $real --base vanilla --out $RJ/contrast-real")
  [ -n "$pilot" ] && specs+=("contrast-pilot|contrast --run $pilot --base vanilla --out $RJ/contrast-pilot")
  for s in "${specs[@]}"; do
    name=${s%%|*}; args=${s#*|}
    say "P4: report $name"
    # shellcheck disable=SC2086
    node_run "$RJ/$name.stdout.txt" $args; rc=$?
    [ "$STOPPING" = 1 ] && return 130
    if [ "$rc" != 0 ]; then warn=$((warn + 1)); say "P4: WARNING: report '$name' exited $rc (see $RJ/$name.stdout.txt). Reports are free: rerun them by hand."; fi
  done
  st_set P4_report_failures "$warn"
  return 0
}
p4_judge() {
  local V RJ d dirs rc n=0 total
  V=$(study_dir) || { fail_phase "no study dir"; return 1; }
  RJ=$V/reports-judged
  mapfile -t dirs < <(cap_dirs "$V")
  total=${#dirs[@]}
  [ "$total" -gt 0 ] || { fail_phase "no task dirs under $V"; return 1; }
  [ -x "$OC" ] || { fail_phase "opencode binary not found or not executable: $OC"; return 1; }
  say "P4: judging $total capability task dirs one after another with the opencode backend on Bedrock (credentials file $CREDS, path only)"
  if [ -n "$CREDS_EXPIRY_UTC" ]; then say "P4: credentials hint: the file is expected to expire about $CREDS_EXPIRY_UTC; if it does, the chain waits for a re-vend and resumes from the cache"; fi
  for d in "${dirs[@]}"; do
    n=$((n + 1))
    p4_judge_one "$d"; rc=$?
    [ "$rc" != 0 ] && return "$rc"
    say "P4: [$n/$total] $(basename "$d") judged"
  done
  p4_reports "$V" "$RJ"; rc=$?
  [ "$rc" != 0 ] && return "$rc"
  hj psummary "$V" "$RJ" > "$PILOT_SUMMARY" 2>/dev/null || say "P4: WARNING: could not write $PILOT_SUMMARY"
  st_set P4_summary "$PILOT_SUMMARY"
  say "P4: wrote $PILOT_SUMMARY"
  return 0
}

# ================================================================ P5 SKILL BENCH STAGE 1
pick_results_root() {
  local c best="" bestfree=0 f
  local -a cands
  IFS=: read -r -a cands <<<"$RESULTS_CANDIDATES"
  for c in "${cands[@]}"; do
    [ -d "$c" ] && [ -w "$c" ] || continue
    f=$(free_gb "$c"); f=${f:-0}
    [ "$f" -gt "$bestfree" ] && bestfree=$f
  done
  for c in "${cands[@]}"; do
    [ -d "$c" ] && [ -w "$c" ] || continue
    f=$(free_gb "$c"); f=${f:-0}
    if [ "$f" -ge $((bestfree * 9 / 10)) ] && [ "$f" -gt 0 ]; then best=$c; break; fi
  done
  [ -n "$best" ] && printf '%s' "$best/konductor-skill-bench-results"
}
exposure_runs() {
  local V d
  if [ -n "$EXPOSURE_OVERRIDE" ]; then printf '%s' "$EXPOSURE_OVERRIDE"; return; fi
  V=$(study_dir) || return 0
  local -a l=()
  if [ -n "$ORCH_STUDY" ]; then
    [ -d "$ORCH_STUDY/claude" ] && l+=("$ORCH_STUDY/claude")
    [ -d "$ORCH_STUDY/gpt" ] && l+=("$ORCH_STUDY/gpt")
  fi
  for d in $(cap_dirs "$V"); do l+=("$d"); done
  join_csv "${l[@]}"
}
SB_SEL=()
sbrun() { "${SB_ENV[@]}" bash "$SB_SCRIPT" "$@"; }
p5_skillbench() {
  local rc attempt=0 off out reason sbv
  [ -n "$OC" ] && [ -x "$OC" ] || { fail_phase "opencode binary not found or not executable: ${OC:-(unset)}; set OC or AC_OC"; return 1; }
  [ -f "$SB_SCRIPT" ] || { fail_phase "run-skill-bench.sh not found: $SB_SCRIPT"; return 1; }
  [ -n "$SB_SKILLS" ] && SB_SEL=(--skills "$SB_SKILLS")
  if [ -z "$SB_RESULTS" ]; then SB_RESULTS=$(pick_results_root); fi
  [ -n "$SB_RESULTS" ] || { fail_phase "no writable results filesystem found"; return 1; }
  mkdir -p "$SB_RESULTS" || { fail_phase "cannot create $SB_RESULTS"; return 1; }
  st_set P5_results "$SB_RESULTS"
  st_set P5_skills "$SB_SKILLS"
  EXPOSURE=$(exposure_runs)
  SB_ENV=(env -u SB_CHILD CREDS="$CREDS" OC="$OC" RESULTS="$SB_RESULTS" EXPOSURE_RUNS="$EXPOSURE" TASKS_PER_SKILL="$SB_TASKS"
    STATE_DIR="$SB_STATE_DIR" REPO="$REPO" CLI_JS="$CLI_JS" BENCH_DIR="$REPO/bench" SCRATCH_PARENT="$SCRATCH_PARENT")
  say "P5: results root $SB_RESULTS ($(free_gb "$SB_RESULTS") GB free; df: $(df -Pk "$SB_RESULTS" | awk 'NR==2{print $1" "$6}')); $SCRATCH_PARENT has $(free_gb "$SCRATCH_PARENT") GB free"
  say "P5: exposure runs: $(printf '%s' "$EXPOSURE" | tr ',' '\n' | wc -l) directories; tasks per skill $SB_TASKS; skills: ${SB_SKILLS:-all}"
  wait_for_credentials "the skill bench stage 1" || { rc=$?; [ "$rc" = 130 ] && return 130; fail_phase "no valid credentials for stage 1; rerun 'bash $SELF' after re-vending"; return 1; }
  pilot_state
  [ "$PS_ALIVE" = 1 ] && { fail_phase "the capability study is running (pid $PS_PID)"; return 1; }
  say "P5: run-skill-bench --preflight"
  out=$(sbrun --preflight "${SB_SEL[@]}" 2>&1); rc=$?
  printf '%s\n' "$out" >> "$SB_LOG"
  if [ "$rc" != 0 ]; then fail_phase "run-skill-bench --preflight failed: $(printf '%s' "$out" | grep -E 'preflight FAIL|FAILED' | head -3 | strip_nl)"; return 1; fi
  say "P5: preflight passed"
  while :; do
    attempt=$((attempt + 1))
    off=$(stat -c %s "$SB_LOG" 2>/dev/null || echo 0)
    say "P5: starting run-skill-bench --foreground (attempt $attempt of $((SB_RETRIES + 1)); controls run first; log $SB_LOG)"
    ( cd "$STATE_DIR" && exec "${SB_ENV[@]}" bash "$SB_SCRIPT" --foreground "${SB_SEL[@]}" ) >> "$SB_LOG" 2>&1 < /dev/null &
    CHILD=$!
    wait_child; rc=$?
    [ "$STOPPING" = 1 ] && return 130
    sbv=$(cat "$SB_STUDYFILE" 2>/dev/null || true)
    [ -n "$sbv" ] && st_set P5_study "$sbv"
    if [ "$rc" = 0 ]; then
      say "P5: run-skill-bench finished (exit 0); study $sbv"
      [ -f "$sbv/decisions/decisions.md" ] && say "P5: decisions: $sbv/decisions/decisions.md" || say "P5: WARNING: no decisions/decisions.md found under $sbv"
      return 0
    fi
    reason=$(tail -c +$((off + 1)) "$SB_LOG" | grep -aoE 'study stopped: [^ ]+' | tail -1 | sed 's/^study stopped: //')
    st_set P5_last_stop "exit $rc reason ${reason:-none recorded}"
    say "P5: run-skill-bench exited $rc; stop reason: ${reason:-none recorded}"
    case "$reason" in
      controls-run-failed*)
        fail_phase "the known-answer controls could not run (the runner exited with an error): see $sbv/logs/controls-run.log; no verdict was made ($reason), so stage 1 stopped. Nothing was applied."
        return 1 ;;
      controls-failed*)
        fail_phase "THE KNOWN-ANSWER CONTROLS FAILED ($reason): no skill verdict can be trusted, so stage 1 stopped. Study $sbv, controls under controls/. Nothing was applied."
        return 1 ;;
    esac
    if [ "${reason#judge-failed}" != "$reason" ] || ! creds_ok; then
      if [ "$attempt" -gt "$SB_RETRIES" ]; then
        fail_phase "run-skill-bench stopped on credentials ($reason) and the $SB_RETRIES reruns are used up. Re-vend and rerun 'bash $SELF' to resume."
        return 1
      fi
      say "P5: stopped on credentials ($reason); waiting for credentials, then rerunning (the study resumes; finished waves and cached judge calls are kept)"
      wait_for_credentials "the skill bench stage 1 (rerun $attempt of $SB_RETRIES)" || { rc=$?; [ "$rc" = 130 ] && return 130; fail_phase "no valid credentials after waiting; rerun 'bash $SELF' after re-vending"; return 1; }
      continue
    fi
    fail_phase "run-skill-bench failed (exit $rc, reason: ${reason:-none recorded}), not a credentials problem. Study ${sbv:-unknown}; log $SB_LOG. Chain stopped."
    return 1
  done
}

# ================================================================ P6 SUMMARY
write_summary() { # write_summary <DONE|FAILED> [phase]
  local outcome=$1 failed_phase=${2:-} n s V sbv
  V=$(study_dir || true)
  {
    echo "After-capability chain summary, generated $(ts)"
    echo "State file: $STATEFILE   Log: $LOG"
    echo
    echo "Per-phase result"
    for n in 1 2 3 4 5 6; do
      s=$(st_get "P$n"); [ "$n" = 6 ] && [ "$outcome" = DONE ] && s="done"
      printf '  P%d %-10s %s' "$n" "${PHASE_NAMES[$n]}" "${s:-not-started}"
      [ -n "$(st_get "P${n}_reason")" ] && printf '  [%s]' "$(st_get "P${n}_reason")"
      echo
    done
    echo
    echo "P2 patches and tests"
    echo "  bench suite: $(st_get P2_tests)"
    for n in 1 2 3 4 5 6 7 8; do [ -n "$(st_get "P2_commit$n")" ] && echo "  commit $n: $(st_get "P2_commit$n")"; done
    [ -n "$(st_get P2_note)" ] && echo "  note: $(st_get P2_note)"
    echo
    echo "P3 autonomy rerun (askedUser and second-turn counts, autonomy runs only)"
    echo "  before the rerun: $(st_get P3_before)"
    echo "  after the rerun:  $(st_get P3_after)"
    echo "  earlier dirs moved to: $(st_get P3_dest)"
    [ -n "$(st_get P3_note)" ] && echo "  note: $(st_get P3_note)"
    echo
    echo "P4 capability judging"
    if [ -s "$PILOT_SUMMARY" ]; then
      sed 's/^/  /' "$PILOT_SUMMARY"
    else
      echo "  (no $PILOT_SUMMARY yet)"
    fi
    echo
    echo "P5 skill bench stage 1"
    sbv=$(st_get P5_study); [ -z "$sbv" ] && sbv=$(cat "$SB_STUDYFILE" 2>/dev/null || true)
    echo "  study: ${sbv:-none}   results root: $(st_get P5_results)   last stop: $(st_get P5_last_stop)"
    if [ -n "$sbv" ] && [ -f "$sbv/decisions/decisions.json" ]; then
      hj decisions "$sbv/decisions/decisions.json" | sed 's/^/  /'
      echo "  decisions.md: $sbv/decisions/decisions.md"
    else
      echo "  decisions: not available yet"
    fi
    echo
    echo "Credits and spend"
    grep -a 'credits so far' "$LOG" 2>/dev/null | tail -2 | sed 's/^/  /'
    echo
    if [ "$outcome" = DONE ]; then echo "DONE"; else echo "FAILED at phase $failed_phase (${PHASE_NAMES[$failed_phase]:-?}): $(st_get "P${failed_phase}_reason")"; fi
  } > "$SUMMARY.tmp" && mv -f -- "$SUMMARY.tmp" "$SUMMARY"
  say "summary written: $SUMMARY"
  : "${V:-}"
}
p6_summary() { write_summary DONE; return 0; }

# ================================================================ phase runner and main
run_phase() { # run_phase <n> <function>
  local n=$1 fn=$2 s rc
  [ "$STOPPING" = 1 ] && return 130
  s=$(st_get "P$n")
  case "$s" in done|skipped) say "P$n ${PHASE_NAMES[$n]}: already $s, skipping (resume)"; return 0 ;; esac
  st_set "P$n" running; st_set CURRENT "$n"; st_set "P${n}_started" "$(ts)"; st_set "P${n}_reason" ""
  say "===== P$n ${PHASE_NAMES[$n]}: START ====="
  FAIL_REASON=""; PHASE_RESULT=""
  "$fn"; rc=$?
  if [ "$rc" = 0 ]; then
    st_set "P$n" "${PHASE_RESULT:-done}"; st_set "P${n}_finished" "$(ts)"
    say "===== P$n ${PHASE_NAMES[$n]}: ${PHASE_RESULT:-done} ====="
    log_credits
    return 0
  fi
  if [ "$rc" = 130 ] || [ "$STOPPING" = 1 ]; then
    st_set "P$n" interrupted
    say "===== P$n ${PHASE_NAMES[$n]}: INTERRUPTED (rerun the script to resume) ====="
    return 130
  fi
  st_set "P$n" failed; st_set "P${n}_reason" "$FAIL_REASON"
  say "===== P$n ${PHASE_NAMES[$n]}: FAILED: $FAIL_REASON ====="
  log_credits
  return 1
}

cleanup_exit() {
  drop_scratch
  if [ -f "$PIDFILE" ] && [ "$(cat "$PIDFILE" 2>/dev/null)" = "$$" ]; then rm -f -- "$PIDFILE"; fi
}

daemon_pid() {
  local p
  p=$(cat "$PIDFILE" 2>/dev/null) || return 1
  alive "$p" && tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q 'run-after-capability' && { echo "$p"; return 0; }
  return 1
}

claim_pidfile() {
  if ( set -o noclobber; echo $$ > "$PIDFILE" ) 2>/dev/null; then return 0; fi
  local other
  if other=$(daemon_pid) && [ "$other" != "$$" ]; then
    say "REFUSED: another run-after-capability instance is alive (pid $other)"
    return 1
  fi
  rm -f -- "$PIDFILE"
  ( set -o noclobber; echo $$ > "$PIDFILE" ) 2>/dev/null
}

run_chain() {
  local n rc names=(p1_wait p2_patch p3_autonomy p4_judge p5_skillbench p6_summary)
  case "$SCRATCH_PARENT" in *[Bb][Ee][Nn][Cc][Hh]*) echo "SCRATCH_PARENT '$SCRATCH_PARENT' contains the word bench" >&2; return 1 ;; esac
  mkdir -p "$STATE_DIR" || return 1
  claim_pidfile || return 1
  trap on_term TERM INT HUP
  trap cleanup_exit EXIT
  say "run-after-capability started, pid $$; state $STATEFILE; resuming from: $(for n in 1 2 3 4 5 6; do printf 'P%d=%s ' "$n" "$(st_get "P$n")"; done)"
  st_set STARTED "$(ts)"; st_set FINAL running
  for n in 1 2 3 4 5 6; do
    run_phase "$n" "${names[$((n - 1))]}"; rc=$?
    if [ "$rc" = 130 ]; then
      st_set FINAL "stopped at phase $n"
      say "STOPPED at phase $n (${PHASE_NAMES[$n]}). Rerun 'bash $SELF' to resume."
      return 130
    fi
    if [ "$rc" != 0 ]; then
      st_set FINAL "FAILED at phase $n"
      write_summary FAILED "$n"
      say "FAILED at phase $n (${PHASE_NAMES[$n]}): $(st_get "P${n}_reason")"
      say "To resume after fixing the cause: bash $SELF"
      return 1
    fi
  done
  st_set FINAL DONE
  say "DONE: all six phases complete. Summary: $SUMMARY"
  return 0
}

# ---------------------------------------------------------------- read-only checks (dry run and launch)
CHECK_FAIL=0
chk() { # ok|WARN|FAIL msg
  case "$1" in
    ok) say "check ok:   $2" ;;
    WARN) say "check WARN: $2" ;;
    *) say "check FAIL: $2"; CHECK_FAIL=1 ;;
  esac
}
patches_apply_to_head() { # read-only: git archive HEAD into a temp dir, then git apply --check and apply each patch there, in order
  local tmp rc=0
  tmp=$(mktemp -d "$SCRATCH_PARENT/ac-tmp.pristine.XXXXXX") || return 2
  if git -C "$REPO" archive HEAD | tar -x -C "$tmp" 2>/dev/null; then
    ( cd "$tmp" && for p in "${PATCH_LIST[@]}"; do git apply --check "$p" && git apply "$p" || exit 1; done ) >/dev/null 2>&1 || rc=1
  else rc=2; fi
  case "$tmp" in "$SCRATCH_PARENT"/ac-tmp.pristine.*) rm -rf -- "$tmp" ;; esac
  return "$rc"
}
readonly_checks() {
  local V dp
  CHECK_FAIL=0
  case "$SCRATCH_PARENT" in *[Bb][Ee][Nn][Cc][Hh]*) chk FAIL "scratch parent '$SCRATCH_PARENT' contains the word bench" ;; *) chk ok "scratch parent $SCRATCH_PARENT has no 'bench' in its path" ;; esac
  for c in node git pgrep tar timeout "$AWS_BIN"; do command -v "$c" >/dev/null 2>&1 && chk ok "tool $c" || chk FAIL "tool $c not found"; done
  [ -f "$CLI_JS" ] && chk ok "bench runner $CLI_JS" || chk FAIL "bench runner missing: $CLI_JS"
  if [ "${#PATCH_LIST[@]}" -eq 0 ]; then chk ok "no patches given (PATCHES unset): P2 will be skipped"
  else for p in "${PATCH_LIST[@]}"; do [ -f "$p" ] && chk ok "patch $p" || chk FAIL "patch file missing: $p"; done; fi
  [ -f "$PILOT_SCRIPT" ] && chk ok "run-real-pilot.sh $PILOT_SCRIPT" || chk FAIL "missing: $PILOT_SCRIPT"
  [ -f "$SB_SCRIPT" ] && chk ok "run-skill-bench.sh $SB_SCRIPT" || chk FAIL "missing: $SB_SCRIPT"
  if [ -n "$OC" ] && [ -x "$OC" ]; then chk ok "opencode binary $OC"; else chk FAIL "opencode binary not found: ${OC:-(unset)}. Set OC (or AC_OC) or put opencode on PATH"; fi
  if [ -z "$CREDS" ]; then chk FAIL "CREDS is not set: point CREDS (or AC_CREDS) at the scoped AWS credentials file; only the path is used"
  elif [ -s "$CREDS" ] && [ -r "$CREDS" ]; then
    chk ok "credentials file present: $CREDS (path only; contents not read${CREDS_EXPIRY_UTC:+; expected to expire about $CREDS_EXPIRY_UTC})"
    if creds_ok; then chk ok "aws bedrock list-foundation-models succeeds with that file (AWS_PROFILE=$AWS_PROFILE_NAME, $AWS_REGION_NAME)"
    else chk WARN "the credentials check fails right now ($CRED_NOTE); P4 and P5 would wait for a re-vend"; fi
  else chk FAIL "credentials file missing or empty: $CREDS"; fi
  if V=$(study_dir); then chk ok "capability study dir $V ($(cap_dirs "$V" | wc -l) task dirs with a summary)"; else chk FAIL "no capability study dir ($PILOT_STUDYFILE)"; fi
  if git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
    chk ok "repo $REPO at $(git -C "$REPO" rev-parse --short=8 HEAD)"
    if [ -z "$BRANCH" ]; then chk ok "branch $(git -C "$REPO" branch --show-current) (AC_BRANCH unset, not pinned)"
    elif [ "$(git -C "$REPO" branch --show-current)" = "$BRANCH" ]; then chk ok "branch $BRANCH"
    else chk FAIL "repo is not on $BRANCH"; fi
    if [ -z "$(git -C "$REPO" status --porcelain bench/)" ]; then chk ok "bench/ is clean"; else
      chk WARN "bench/ is not clean right now ($(git -C "$REPO" status --porcelain bench/ | head -3 | strip_nl)); P2 will refuse unless it is the patches uncommitted"; fi
    case "$(st_get P2)" in
      done|skipped) chk ok "P2 is already $(st_get P2) in the state file; the patch check is skipped (resume)" ;;
      *) if [ "${#PATCH_LIST[@]}" -gt 0 ]; then
           patches_apply_to_head && chk ok "the patches apply in order to a pristine archive of HEAD" || chk FAIL "the patches do not apply to a pristine archive of HEAD"
         fi ;;
    esac
  else chk FAIL "not a git repository: $REPO"; fi
  pilot_state
  dp=$PS_PID
  if [ "$PS_ALIVE" = 1 ]; then chk ok "capability study is running (pid $dp); P1 will wait. Last log line: ${PS_LAST:-(empty)}"
  elif is_done_line "$PS_LAST"; then chk ok "capability study already finished; P1 will pass at once"
  else chk WARN "capability study is not running and its log does not end with DONE (last: ${PS_LAST:-(empty)}); P1 would stop the chain"; fi
  return "$CHECK_FAIL"
}

p2_plan_line() {
  if [ "${#PATCH_LIST[@]}" -eq 0 ]; then echo "  P2 PATCH       skipped: no patches given (set PATCHES)"; return; fi
  echo "  P2 PATCH       in $REPO${BRANCH:+ ($BRANCH)}: gates, git apply --check, apply ${PATCH_LIST[*]} in order, node --test \"bench/runner/test/*.test.js\" (scratch HOME), 0 failures or git apply -R; ${#PATCH_LIST[@]} local commit(s), no push"
}
p3_plan_line() {
  if [ "$RERUN_AUTONOMY" != 1 ]; then echo "  P3 AUTONOMY    skipped: RERUN_AUTONOMY is not 1"; return; fi
  echo "  P3 AUTONOMY    move $1/$AUTON_GLOB to $1/incomplete/$P3_DEST_PREFIX-<UTC>/ ; bash $PILOT_SCRIPT --foreground (reruns exactly those); askedUser/second-turn before vs after"
}
print_plan() {
  local V
  V=$(study_dir || echo "(none)")
  cat <<EOF
PLAN (each phase gated on the previous; state in $STATEFILE; resume = rerun)
  P1 WAIT        poll ${POLL_S}s until $PILOT_PIDFILE is gone/not alive and the last line of $PILOT_LOG is DONE; FAILED or dead-without-DONE stops; timeout $(fmt_dur "$WAIT_TIMEOUT_S")
$(p2_plan_line)
$(p3_plan_line "$V")
  P4 JUDGE       bench.js judge --run <each task dir> --judge-backend opencode --opencode-bin ${OC:-(unset)} --aws-creds-file ${CREDS:-(unset)} --aws-profile $AWS_PROFILE_NAME --aws-region $AWS_REGION_NAME --profile detailed --concurrency $JUDGE_CONC --budget-usd $JUDGE_BUDGET ; wait for credentials (poll ${CRED_POLL_S}s, up to $(fmt_dur "$CRED_TIMEOUT_S")); reports into $V/reports-judged/ ; $PILOT_SUMMARY
  P5 SKILL BENCH bash $SB_SCRIPT --foreground${SB_SKILLS:+ --skills $SB_SKILLS} with CREDS, EXPOSURE_RUNS, TASKS_PER_SKILL=$SB_TASKS, RESULTS on the roomiest filesystem; up to $SB_RETRIES credential reruns; a failed control stops it
  P6 SUMMARY     $SUMMARY (ends with DONE or FAILED at phase N)
EOF
  [ -n "$CREDS_EXPIRY_UTC" ] && echo "Credentials hint: the file is expected to expire about $CREDS_EXPIRY_UTC."
  return 0
}

# ---------------------------------------------------------------- entry points
case "$MODE" in
  status)
    LOGTO=0; ECHO=1
    if dp=$(daemon_pid); then echo "daemon: running, pid $dp"; else echo "daemon: not running"; fi
    echo "log: $LOG    state: $STATEFILE"
    if [ -f "$STATEFILE" ]; then
      for n in 1 2 3 4 5 6; do printf '  P%d %-10s %s%s\n' "$n" "${PHASE_NAMES[$n]}" "$(st_get "P$n")" "$([ -n "$(st_get "P${n}_reason")" ] && printf '  [%s]' "$(st_get "P${n}_reason")")"; done
      echo "  final: $(st_get FINAL)   waiting for credentials: $(st_get WAITING_FOR_CREDENTIALS)"
    else echo "  no state yet (nothing has run)"; fi
    pilot_state
    echo "capability study: $([ "$PS_ALIVE" = 1 ] && echo "running, pid $PS_PID" || echo 'not running')   last log line: ${PS_LAST:-(none)}"
    echo "last 15 log lines:"; tail -n 15 "$LOG" 2>/dev/null | sed 's/^/  /'
    exit 0 ;;
  stop)
    if dp=$(daemon_pid); then kill -TERM "$dp" && echo "sent SIGTERM to $dp; the running child is stopped and the state records where; resume: bash $SELF   watch: tail -f $LOG"; else echo "not running"; fi
    exit 0 ;;
  dry-run)
    LOGTO=0; ECHO=1
    echo "DRY RUN: nothing is changed (no state, no log, no checkout edit)"
    print_plan
    echo
    readonly_checks; rc=$?
    echo
    echo "dry run: $([ "$rc" = 0 ] && echo 'all checks passed' || echo 'a check failed; a real launch would refuse')"
    exit "$rc" ;;
esac

if [ "${AC_CHILD:-0}" != 1 ]; then
  ECHO=1
  mkdir -p "$STATE_DIR" || exit 1
  if dp=$(daemon_pid); then echo "REFUSED: already running (pid $dp). Use: bash $SELF --status | --stop"; exit 1; fi
  readonly_checks || { say "launch checks failed; nothing launched"; exit 1; }
  if [ "$MODE" = daemon ]; then
    printf -- '---- launched %s ----\n' "$(ts)" >> "$LOG"
    AC_CHILD=1 setsid nohup bash "$SELF" --foreground >> "$LOG" 2>&1 < /dev/null &
    for _ in $(seq 1 20); do dp=$(daemon_pid) && break; sleep 0.5; done
    if dp=$(daemon_pid); then
      echo "LAUNCHED: pid $dp"
      echo "log:     tail -f $LOG"
      echo "status:  bash $SELF --status"
      echo "stop:    bash $SELF --stop     (resume: rerun this script)"
      exit 0
    fi
    echo "the daemon did not start or was refused; see $LOG"; exit 1
  fi
fi
run_chain
exit $?
