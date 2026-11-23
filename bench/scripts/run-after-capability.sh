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
#   bash run-after-capability.sh               checks, then self-daemonizes (a detached session, like setsid nohup) and returns
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
# FILES (under AC_STATE_DIR, default: a per-user dir, see state-dir.sh)
#   after-capability.log / .state / .pid / -summary.txt, real-pilot-summary.txt, after-capability-p2-tests.log,
#   real-pilot-autonomy-rerun.log, judge-capability-<dir>.log
#
# ENVIRONMENT OVERRIDES (defaults in brackets)
#   AC_STATE_DIR [per-user dir, see state-dir.sh]        AC_REPO [the checkout this script sits in]   AC_BRANCH [unset: any branch, not detached]
#   AC_CLI_JS [$AC_REPO/bench/runner/bench.js]
#   AC_PATCHES / PATCHES   comma list of patch files for P2, applied in order   [unset: P2 is skipped]
#   AC_RERUN_AUTONOMY / RERUN_AUTONOMY  1 runs P3   [1 when PATCHES is set, else 0]   AC_P3_DEST_PREFIX [autonomy-rerun]
#   AC_AUTONOMY_GLOB [pilot-autonomy-*]  task dir names P3 moves and reruns
#   AC_PILOT_PIDFILE / AC_PILOT_LOG / AC_PILOT_STUDYFILE [$AC_STATE_DIR/real-pilot.{pid,log,study}]
#   AC_PILOT_SCRIPT [run-real-pilot.sh beside this script]  AC_PILOT_PROC_PATTERN [run-real-pilot]
#   BUDGET_CREDITS  passed on to run-real-pilot.sh for the P3 rerun; its preflight refuses to run without it
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

# Thin launcher: the chain lives in lib/chain/ (main.js runs the phases, the state file, the modes and the daemon).
# This script resolves the state dir (refusing a symlink) and prints --help from the header above.
SELF=$(readlink -f "${BASH_SOURCE[0]}")
SELF_DIR=$(dirname "$SELF")
. "$SELF_DIR/state-dir.sh"
bench_strict
AC_STATE_DIR=$(bench_state_dir "${AC_STATE_DIR:-}") || exit 1
export AC_STATE_DIR
for a in "$@"; do
  case "$a" in -h|--help) awk 'NR>1 && /^set -u/ {exit} NR>1 {sub(/^# ?/, ""); print}' "$SELF"; exit 0 ;; esac
done
exec node "$SELF_DIR/lib/chain/main.js" --self "$SELF" "$@"
