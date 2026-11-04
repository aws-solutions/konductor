# Runbook: running and monitoring an unattended benchmark study

This is the operator's guide to the scripts in `bench/scripts/` that run a long study without a person at the keyboard. For the benchmark itself (suites, arms, judging, reports) see `bench/README.md`. For the per-skill study see `bench/CAP-PLAYBOOK.md`.

All commands are `bash <script>` from any directory. Nothing needs `sudo`. The scripts share one state directory, `STATE_DIR` (default `/tmp/konductor-bench`, `AC_STATE_DIR` for the chain). If `/tmp` is a RAM-backed tmpfs on your host, a reboot loses it; set `STATE_DIR` and `RESULTS` to a disk path for a study that must survive one.

## The scripts

| Script | Purpose |
|---|---|
| `run-real-pilot.sh` | Capability study: the tasks in a task file, one `bench.js run` per task, on vanilla plus konductor arms. |
| `run-after-capability.sh` | The chain: waits for the capability study, then runs the optional patch and autonomy-rerun phases, judging, the skill bench and a summary. |
| `run-skill-bench.sh` | Per-skill study (delete, prune or keep). See `bench/CAP-PLAYBOOK.md`. |
| `run-judging.sh` | Judges a finished orchestrator study (one directory per cell) and writes the final reports. |
| `monitor.sh` | Read-only dashboard of the chain. |
| `real-pilot-tasks.txt` | Default task list for `run-real-pilot.sh`. |

Every script takes `--help`.

## What the chain runs

`run-after-capability.sh` runs six phases one after another and records each result in `after-capability.state`:

| Phase | Name | What it does |
|---|---|---|
| P1 | WAIT | Polls every 60 s until the capability study (`run-real-pilot.sh`) has finished. |
| P2 | PATCH | Optional. Skipped unless `PATCHES` lists patch files. Otherwise applies them to the checkout in order, runs the bench suite, and makes one local commit per patch. Nothing is pushed. A failing suite reverts every patch. |
| P3 | AUTONOMY | Optional. Runs when `RERUN_AUTONOMY=1`, which is the default once `PATCHES` is set. Moves the autonomy task dirs to `incomplete/autonomy-rerun-<UTC>/` and reruns them through `run-real-pilot.sh --foreground`. |
| P4 | JUDGE | Judges every capability task dir with the opencode backend on Bedrock, then builds the free reports and `real-pilot-summary.txt`. Needs valid AWS credentials. |
| P5 | SKILLBENCH | `run-skill-bench.sh --foreground` (stage 1). Known-answer controls run first; a failed control stops the chain. Needs valid credentials. |
| P6 | SUMMARY | Writes `after-capability-summary.txt` and ends with `DONE` or `FAILED at phase N`. |

## Set up a fresh study

1. Fetch the real-repo cache once: `node bench/real/fetch.js --cache DIR` (the only networked step). Point `REAL_CACHE` at it.
2. Choose the arms. With no `ORCH_DIR` the arms are `vanilla,main`. To test a branch, check it out in a separate worktree and set `ORCH_DIR` to it. The arm under test is listed first, so the A/A repeat is of that arm.
3. Optionally edit a copy of `real-pilot-tasks.txt` and point `TASKS_FILE` at it. Each line is `suite|task|timeoutSec|kind|estSecPerTaskDir`.
4. Run the smoke test (a few cents): `SMOKE=1 bash run-real-pilot.sh`. It runs one real task, an optional two-turn autonomy probe (set `PROBE_BENCH`), and one autonomy task, and writes the autonomy marker file that decides whether the autonomy tasks run.
5. Start the capability study: `bash run-real-pilot.sh`.
6. Start the chain: set `CREDS`, then `bash run-after-capability.sh`. The chain waits in P1 until the study is done, so it can be started first.

```bash
export ORCH_DIR=/path/to/worktree-of-the-branch-under-test
export REAL_CACHE=/path/to/real-repo-cache
export CARGO_TARGET=/path/to/cargo-target
bash bench/scripts/run-real-pilot.sh --dry-run    # preflight and the exact commands
bash bench/scripts/run-real-pilot.sh              # daemonizes
CREDS=/path/to/creds bash bench/scripts/run-after-capability.sh --dry-run
CREDS=/path/to/creds bash bench/scripts/run-after-capability.sh
```

## Run the chain

```bash
bash run-after-capability.sh --dry-run   # read-only: shows the plan and checks everything; changes nothing
bash run-after-capability.sh             # runs the checks, then daemonizes (setsid nohup) and returns
bash run-after-capability.sh --status    # daemon state, phase table, last log lines
bash run-after-capability.sh --stop      # SIGTERM; the running child is stopped and the state records where
bash run-after-capability.sh             # resume: finished phases are skipped, the interrupted one restarts
```

Notes:

- A second instance is refused while one is alive.
- `--foreground` runs it in the current terminal instead of as a daemon.
- Exit codes: 0 done or launched, 1 failed or refused, 2 bad usage, 130 stopped.
- Do not run `konductor install` or `konductor update`, switch branches, or edit `bench/` in the checkout while a study runs. The study hashes `~/.konductor/installs` before and after every run and fails with `ISOLATION FAILURE` if it changes.
- Chain environment variables (all optional except credentials; defaults are in the script header): `AC_JUDGE_BUDGET_USD` (25 per task dir), `AC_JUDGE_CONCURRENCY` (2), `AC_SB_RETRIES` (3), `AC_WAIT_TIMEOUT_S`, `AC_CRED_POLL_S` (300), `AC_SB_SKILLS`, `AC_TASKS_PER_SKILL` (5), `AC_REPO`, `AC_BRANCH`.

### P2: applying patches (optional)

Set `PATCHES` to a comma list of patch files. P2 checks that they apply to a clean archive of `HEAD`, applies them in order, runs `node --test "bench/runner/test/*.test.js"` in a scratch HOME, and commits each patch separately. The commit message comes from `<patch>.msg` if it exists, else from the patch's mail header, else `bench: apply <patch name>`. It is scanned with `bench/cap/public.js` before committing. Files are staged by name and nothing is pushed. With no `PATCHES` the phase logs `SKIPPED` and the chain moves on.

### The two scripts the chain drives, on their own

```bash
bash run-real-pilot.sh --status          # capability study: tasks done, runs, credits, ETA
bash run-real-pilot.sh --stop
bash run-real-pilot.sh --foreground
bash run-real-pilot.sh --dry-run
bash run-real-pilot.sh --preflight       # preflight plus the free prepare-only of the arm set
bash run-skill-bench.sh --status         # skill bench: controls result, waves done, runs, credits
bash run-skill-bench.sh --dry-run        # plan and exact commands, runs nothing
```

### Judging an orchestrator study

`run-judging.sh` judges a finished study directory with one sub-directory per cell (`CELLS`, default `claude gpt`).

```bash
STUDY=/path/to/study bash run-judging.sh --dry-run             # the plan and exact commands; needs no credentials
STUDY=/path/to/study CREDS=/path/to/creds bash run-judging.sh  # background; rerun to resume from the cache
STUDY=/path/to/study bash run-judging.sh --status
```

A budget stop exits 3. Raise the cap and rerun: `BUDGET_USD=25 bash run-judging.sh` (finished calls are cached and not paid again). `SMOKE` names an optional smoke script that makes a few real judge calls first.

### Credentials (P4, P5 and run-judging.sh)

`CREDS` (or `AC_CREDS` for the chain) names a scoped AWS credentials file. There is no default and a launch refuses without it. Only its path is used; no script here reads or prints its contents. The profile inside the file is `AWS_PROFILE_NAME` (default `bench`, which is also what `bench.js` and `run-skill-bench.sh` use) and the region is `AWS_REGION_NAME` (default `us-east-1`). `CREDS_EXPIRY_UTC` is an optional hint that the scripts print and warn about.

If the credentials are invalid or expire, the chain logs `WAITING FOR CREDENTIALS: re-vend the credentials to <path>` and polls every 5 minutes for up to 12 hours. After a re-vend to the same path it resumes by itself. Finished judge calls are cached, so nothing is paid for twice.

## Monitor it

One command shows the whole pipeline. It is read-only.

```bash
bash monitor.sh              # one screen (about 30 lines), then exits
bash monitor.sh --watch      # redraws in place every 30 s until Ctrl-C
bash monitor.sh --watch 10   # same, every 10 s
bash monitor.sh --json       # the same facts as JSON, for scripts (jq)
bash monitor.sh --all        # adds the capability-study summary: judged report paths, decisions
bash monitor.sh --save       # also writes the frame to monitor.last.txt
bash monitor.sh -h
```

### How to read the screen

| Line | Meaning |
|---|---|
| `CHAIN` | Is the chain alive (pid, uptime), which phase it is in and for how long. `NOT RUNNING` means the process is gone. `FINISHED` means it ended with `DONE`. |
| `PHASES` | A bar for phases done (equal weight, so it moves in six steps), then one line per phase: `[x]` done, `[>]` running, `[ ]` pending, `[!]` failed, `[-]` skipped, `[~]` interrupted, with a one-line result. |
| `DOING` | What is happening right now in words: the autonomy task, arm and replicate and how long that run has taken against its timeout (P3); the task dir being judged and its judge call count (P4); the skill and wave (P5). |
| `PROGRESS` | A bar for the current phase with counts: runs for P3, task dirs judged for P4, waves for P5. The ETA is a straight-line estimate from the pace so far. Treat it as rough, because run times differ by arm and P5 can add waves. |
| detail lines | P3: task dirs done, runs per arm, `askedUser`, `questionsAsked`, `turns==2`, credits, run statuses. P4: judge calls per task dir, USD spent, parse failures, judge errors. P5: controls result, waves, runs, credits, and the decision counts (`DELETE`, `PRUNE`, `KEEP`, `NEEDS DATA`) once `decisions.json` exists. |
| `HEALTH` | `ISOLATION FAILURE`, `WAITING FOR CREDENTIALS` (with the expiry hint from the chain log), `FAILED lines` since the latest launch, timeouts and errors in the current phase, free space on `MON_DISK_PATH` (default `/tmp`), and any bench process that is not a child of the chain. |
| last 5 lines | The tail of the log that belongs to the current phase. |
| `VERDICT` | `OK`, `ATTENTION`, `DONE` or `FAILED`. For `ATTENTION` and `FAILED` a `TO-DO` line says what to do. |

### Verdicts and what to do

| Verdict | Cause | Action |
|---|---|---|
| `OK` | Chain alive, nothing wrong found. | Nothing. |
| `ATTENTION: waiting for credentials` | P4 or P5 is paused. | Re-vend the credentials to the path shown. The chain resumes on its own within 5 minutes. |
| `ATTENTION: chain not running` | The process died or was stopped before `DONE`. | `bash run-after-capability.sh` to resume. |
| `ATTENTION: ISOLATION FAILURE` | The installs gate or a log reports a change in the real konductor installs. | Stop and inspect. Do not run `konductor install` or `update` during a study. |
| `ATTENTION: N timeouts/errors` | Runs with a non-success status, judge errors or parse failures in the current phase. | Read the log named in the TO-DO. Timeouts stay in the study and are reported; decide after the phase. |
| `ATTENTION: no log output for ...` | The active log has been silent for more than 30 minutes (`MON_STALL_MIN`) while the chain is alive. | Check that the processes are alive (`ps -ef`). |
| `ATTENTION: stray bench process(es)` | A bench process outside the chain's process tree is running. | Check its pid. It can disturb the study. |
| `FAILED` | A phase is marked failed. The reason is on the screen and in `after-capability-summary.txt`. | Fix the cause, then rerun `bash run-after-capability.sh`. Finished phases are skipped. |
| `DONE` | All six phases finished. | Read `after-capability-summary.txt` and `real-pilot-summary.txt`. |

### What `monitor.sh` does and does not do

- Reads state, logs and `result.json` files. Its only subprocesses beyond `ps`, `df`, `jq` and `grep` are `run-after-capability.sh --status` and `run-skill-bench.sh --status` (the second only once a skill study exists).
- Never starts, stops or signals anything. Never opens the credentials file; it only repeats the chain log's credential lines. Calls no AWS, kiro-cli, opencode or model.
- Writes only `monitor.last.txt`, and only with `--save`.
- Environment overrides: `STATE_DIR`, `STUDY` (default: contents of `real-pilot.study`), `MON_STALL_MIN`, `MON_COLS`, `MON_PROC_RE`, `MON_DISK_PATH`.

### Manual checks (what the screen is built from)

```bash
tail -f "$STATE_DIR/after-capability.log"             # chain events and phase markers
tail -f "$STATE_DIR/real-pilot-autonomy-rerun.log"    # P3 runs
tail -f "$STATE_DIR/judge-capability-<task-dir>.log"  # P4, one log per task dir
tail -f "$STATE_DIR/skill-bench.log"                  # P5
cat "$STATE_DIR/after-capability.state"               # phase results as KEY=VALUE
cat "$STATE_DIR/after-capability-summary.txt"         # written at the end (P6 or on failure)
```

Phase markers in the chain log look like `===== P3 AUTONOMY: START =====` and `===== P3 AUTONOMY: done =====`.

## Files in the state directory

| File | Written by | Content |
|---|---|---|
| `after-capability.log`, `.state`, `.pid` | chain | Events, per-phase results, daemon pid. |
| `after-capability-summary.txt` | chain (P6 or on failure) | Per-phase results and the final `DONE` or `FAILED at phase N`. |
| `after-capability-p2-tests.log` | P2 | Bench suite output. |
| `real-pilot-autonomy-rerun.log` | P3 | Output of the autonomy rerun. |
| `judge-capability-<dir>.log` | P4 | One judge log per task dir. |
| `real-pilot-summary.txt` | P4 | Judge spend, errors, pass-rule and platform verdicts, report paths. |
| `real-pilot.study`, `real-pilot.log`, `real-pilot.pid` | capability study | Path of the study dir, log, daemon pid. |
| `skill-bench.log`, `.pid`, `.study` | P5 | Skill bench log, pid, study pointer. |
| `judging.log`, `judging.pid`, `judging-summary.txt` | `run-judging.sh` | Log, pid, final summary. |
| `monitor.last.txt` | `monitor.sh --save` | The last frame. |

## Testing the scripts

The scripts are covered by tests that use a fake `bench.js`, a fake state directory, a fake `aws` and a throwaway git repo. No model, no network, no real credentials.

| Test file | Covers |
|---|---|
| `bench/runner/test/pipeline-scripts.test.js` | `bash -n`, shellcheck, `--help` and usage errors for every script, and `run-real-pilot.sh`. |
| `bench/runner/test/pipeline-chain.test.js` | `run-after-capability.sh`: credential refusal, dry run, every phase, patches, rollback, the autonomy rerun, daemon mode. |
| `bench/runner/test/pipeline-judging.test.js` | `run-judging.sh`: required variables, preflight, smoke test, budget stop, reports, summary. |
| `bench/runner/test/pipeline-monitor.test.js` | `monitor.sh`: every verdict from a fake state directory, `--json`, `--save`. |
| `bench/runner/test/pipeline-runbook.test.js` | This file against the scripts: every script, flag, variable and path it names exists. |
| `bench/runner/test/pipeline-scripts-hygiene.test.js` | No machine paths, accounts, session ids or study constants in the committed files. |

```bash
node --test "bench/runner/test/pipeline-*.test.js"
```
