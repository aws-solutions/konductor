# Owner operations scripts

The owner runs these scripts from the agent workspace (`<workspace>/scripts/` and
`<workspace>/reports/next-experiment-2026-11-22/`). That workspace is not a git repository, so the scripts had no
history and no review. They are versioned here now (DEBT D-236). The workspace keeps the old paths as thin launchers,
so every old command still works.

## How it fits together

| Part | Where | Job |
| --- | --- | --- |
| Versioned script | `bench/ops/workspace/<f>`, `bench/ops/next-experiment-2026-11-22/<f>` | The real code. It reads the workspace from `KONDUCTOR_WS` and stops when that is not set, so no committed file names a host path. |
| Launcher | `<workspace>/scripts/<f>`, `<workspace>/reports/next-experiment-2026-11-22/<f>` | Sets `KONDUCTOR_WS` to the workspace and runs the versioned copy with the same arguments. Data files (JSON, prompt, queue) are symlinks. |
| Ops checkout | `<workspace>/worktrees/ops` (or `KONDUCTOR_OPS`) | A detached checkout of `feat/bench-pilot-nk` that the launchers run from. |
| Message helpers | `bench/ops/lib.sh` | `say`, `stop` and `fail`, sourced (`. "$(dirname "$0")/../lib.sh"`) by the 26 scripts that had copied them; a script that needs another form defines its own after the source line (B-005). `runner/test/ops-lib.test.js` checks what each prints and that no script keeps a copy. |
| Launcher writer | `bench/ops/make-launchers.sh <workspace> [--replace]` | Writes every launcher. It refuses a file that is not a launcher yet unless `--replace` is given, and never replaces a script a running process names. |

Change a script here, land it, then move the ops checkout to the new head:

```bash
git -C <workspace>/worktrees/ops fetch origin feat/bench-pilot-nk
git -C <workspace>/worktrees/ops checkout --detach FETCH_HEAD
```

After the checkout moves, rewrite the launchers so a script that is new on the branch gets one (the old file is
backed up first, because `--replace` overwrites a plain copy):

```bash
bash <workspace>/worktrees/ops/bench/ops/make-launchers.sh <workspace> --replace
```

`bench/ops/make-launchers.sh <workspace> --check` writes nothing and exits 1 when a workspace owner script is a plain
file instead of a launcher (an edited copy that drifts, or a script never versioned), or a launcher's script is gone.
`bench/scripts/test.sh` runs it whenever `KONDUCTOR_WS` is set, as it is under the workspace's
`run-full-suite-twice-v2.sh`, so the counted suite reads such a file as a failure. `bench/runner/test/ops-launchers.test.js`
runs every launcher against a stub copy of this folder and checks that this page lists every file.

`keep-creds-fresh.sh` stays in the workspace only: it names an AWS account and role. The workspace `scripts/README.md`
is the docs owner's page and points here.

## Scripts from `<workspace>/scripts/` (`bench/ops/workspace/`)

"Superseded" scripts are kept for reference only; use the v2 script. Which scripts retire is the owner's call (FW-22).

| File | What it does |
| --- | --- |
| `arm-fake-turns.json` | The scripted turns `run-physical-ai-wave0.sh` feeds the fake arm agent on its free path. |
| `arm-pose-two-host.sh` | The two-host pose repeat check of DEBT D-30, one command per step. Free. |
| `arm-signed-release-test-v2.sh` | The arm policy test and the five arm controls on a signed release, in one command. |
| `debt-paid/bundle-complex.js` | Builds the recheck work dir of a complex task (`cx-` id): `task.json` without review or authorship, the fixture without its answer key, the hidden tests and goldens. Free. |
| `debt-paid/jobs.txt` | The seven paid debt jobs (D-132, D-167, D-123, D-159, D-137, D-275, D-284): each job's cap and its calls (name, kind, model, the writer a recheck reads, tasks). |
| `debt-paid/own-pin.sh` | Sourced by the D-275 and D-284 wrappers: points the job at its own checkout and moves it to the branch head while the job has spent nothing and the checkout is clean. Free. |
| `debt-paid/prep.js` | Helpers of `debt-paid/run.sh`: each call's prompt and bundle (the map step's template, the recheck bundle, a new task's batch author prompt), its result and its real credits. Free. |
| `debt-paid/prompts/cx-recheck.md` | The D-275 recheck prompt: hidden tests and goldens of a CardDemo task against its rules, interface and COBOL; a list of mismatches in `recheck.json`. |
| `debt-paid/prompts/D-123-W1.md` | The D-123 writer brief: an env-free shared limiter in `t5-qa-flaky-fix`. |
| `debt-paid/prompts/D-137-W1.md` | What the dropped `t1-refactor-permission-boundary` drafts got wrong, added to its T1 author prompt. |
| `debt-paid/prompts/D-137-W2.md` | What the dropped `t1-refactor-logging-migration` draft got wrong, added to its T1 author prompt. |
| `debt-paid/prompts/D-159-W1.md` | The D-159 writer brief: `t3-db-order-history` without the composite hint, and a key inside the fixture limits. |
| `debt-paid/run.sh` | The engine of the six paid debt jobs: one kiro-cli call at a time in an empty HOME on a pinned checkout; `--plan` (the default) is free; `--go` is paid, counts each call at the larger of 15 and its real credits against the job's hard cap, refuses while another paid job runs, resumes on a rerun. |
| `debt-paid/test-run.sh` | Test of `debt-paid/run.sh` and the six `run-debt-*.sh` wrappers with a stub kiro-cli (plans, map and write results, resume, counted credits, the cap, busy and lock refusals, no result, families). Free. |
| `junk-audit-2026-11-24.md` | Read-only audit of workspace worktrees, recheck scratch in `/var/tmp` and duplicate reports, grouped SAFE, CHECK and KEEP for the owner's review. Nothing removed. |
| `kp-pilot-lib.sh` | Shared steps of the keep-or-prune pilot wrappers. Sourced, not run. |
| `lite-fill.js` | Free helper for `run-lite-konductor-v2.sh`: reads results and moves `.done` markers. |
| `lite-helper.js` | Free helper for the LITE run and judge scripts. Reads files only. |
| `lite-rejudge-estimate.js` | Free cost estimate for `run-lite-rejudge.sh --plan`. |
| `lite-rejudge-gap.js` | The judged gap per task, first pass against the re-judge. Free. |
| `rebuild-arm-venv.sh` | Checks (`--check`) or rebuilds the arm venv on a Python 3.12 outside the Kiro Crew runtime, with the pinned wheels; keeps the old one as `.broken`. Free; downloads wheels. |
| `regate-open-set.sh` | The full conveyor open-set re-gate in one command. |
| `run-after-tonight.sh` | Second unattended command of one night (2026-11-21). |
| `run-all-in-order.sh` | Runs several owner commands one after another. |
| `run-arm-and-ns-recheck.sh` | Free recheck after the 2026-11-22 morning failures. |
| `run-arm-test-on-head.sh` | Runs `arm-signed-release-test-v2.sh` on the current origin head. |
| `run-cc-plant-check-v2.sh` | The first real Claude Code plant check. Paid. |
| `run-cc-plant-check.sh` | Superseded by `run-cc-plant-check-v2.sh`. |
| `run-clean-fill.sh` | The clean-run plan of 2026-11-24 in one command: `--plan` (free: every step's plan), `--go` (Kiro Opus fill, then the nudge, Opus-fill and Claude Code judge passes, one at a time; refused while `run-cc-compare.sh` runs; the Claude Code fill step left on 2026-11-24, D-247: 0 cells to fill). Paid. |
| `run-debt-d123-limiter.sh` | D-123: gpt-5.6-luna makes `t5-qa-flaky-fix`'s shared limiter a real order bug, then a deepseek-3.2 recheck. Paid (cap 30 counted); `--plan` is free. |
| `run-debt-d132-map.sh` | D-132: glm-5 maps the two CV-E held-out T8 tasks. Paid (cap 30 counted); `--plan` is free. |
| `run-debt-d137-refactor.sh` | D-137: deepseek-3.2 writes the two T1 refactor tasks again from their briefs, each with a glm-5 recheck. Paid (cap 60 counted); `--plan` is free. |
| `run-debt-d284-recheck.sh` | D-284: deepseek-3.2 rechecks the three time-limit-only versions (t8-bug-retry-storm v4, t9-browser-tab-regression v3, t9-bug-tabs-focus v2). Paid with `--go`, hard cap 45 counted (no `--cap` or `--call-worst` flag); `--plan` is free. Its own checkout `worktrees/d284-recheck` (`debt-paid/own-pin.sh`). |
| `run-debt-d275-cx-recheck.sh` | D-275 and D-276: gpt-5.6-luna, deepseek-3.2 and glm-5 each recheck `cx-carddemo-port` and `cx-carddemo-batchday` (6 calls). Paid (plan default cap 105 counted); `--plan` is free; `--go` needs `--cap N`. |
| `run-debt-d159-rewrite.sh` | D-159: qwen3-coder-next rewrites `t3-db-order-history` and its key, then a gpt-5.6-luna recheck. Paid (cap 75 counted); `--plan` is free. |
| `run-debt-d167-remap.sh` | D-167: glm-5 re-maps the 12 coverage-gap stage 1 tasks from the filled catalogue. Paid (cap 180 counted); `--plan` is free. |
| `run-overnight.sh` | The overnight chain of 2026-11-24: the credential refresher, a wait (up to 8 h) for `run-cc-compare.sh` to end, `run-clean-fill.sh --go`, then the Claude Code judge (its free `--plan` first). Stops at the first failing step. Paid, through the approved caps of each step. |
| `debt-open-rows.js` | Lists the rows of `bench/DEBT.md` that are not closed, with counts by status, owner and area. Free, read only. |
| `dryrun-four.sh` | Free dry-run gate for four task prompts (t2, t4, t7), run from the ops checkout. |
| `gen-recheck-report-2026-11-24.py` | Writes the recheck report of the 2026-11-24 batch from a queue file and its result files. Free. |
| `t3-order-history-v9-bump.py` | Bumps t3-db-order-history from v8 to v9; refuses when a JSON round trip changes the file. Free. |
| `run-full-suite-twice-v2.sh` | KR k485f5870: two full suite runs through `bench/scripts/test.sh --tap`, then the reading. Free. |
| `run-fw30-rewrite.sh` | FW-30: the pilot tasks written again from `briefs-fw30.json`, deepseek-3.2 writes, glm-5 reviews. Paid (cap 120); `--dry-run` is free. |
| `run-lite-judge.sh` | Judge pass of the LITE konductor-against-plain run. Paid (USD). |
| `run-lite-konductor-v2.sh` | LITE konductor-against-plain run, v2. Paid. |
| `run-lite-konductor.sh` | LITE konductor-against-plain run, v1. Paid. |
| `run-lite-rejudge.sh` | Re-judge of the LITE run with the unquoted-evidence re-ask. Paid (USD). |
| `run-morning.sh` | Third unattended command of one night (2026-11-21). |
| `run-namespace-test-v2.sh` | DEBT D-165 second try: the namespace case with a Python that has pytest. |
| `run-namespace-test.sh` | DEBT D-165: only the namespace case of `real-run.test.js` on the origin head. |
| `run-nudge-fill.sh` | The nudge study's fill stage in one command: `--plan` (free), `--go` (the 3 budget-skipped cells, cap 60 counted credits), `--judge-plan` (free), `--judge` (those two tasks, cap USD 0.5, then the 8-task report). |
| `run-physical-ai-wave0.sh` | Physical AI wave 0 in one command. |
| `run-pilot-author.sh` | Keep-or-prune pilot step 1: writes the tasks. Paid. |
| `run-pilot-freeze.sh` | Keep-or-prune pilot step 2: freezes the read draft. Free. |
| `run-pilot-replace.sh` | Keep-or-prune pilot option B: replaces one task. Paid. |
| `run-pilot-run.sh` | Keep-or-prune pilot step 3: the quick run. Paid. |
| `run-pilot-rerun.sh` | Keep-or-prune pilot step 3 again after pilot 1: controls only (cap 1,800), then `--unit` (cap 3,375). Paid. |
| `run-pilot-v2-rerun.sh` | Keep-or-prune pilot rerun on baseline v2 with the FW-36 role line on both unit arms; needs the v2 sign-off and the Fable review mark (or `--skip-fable-review`). Paid (cap 3,240, `UNIT_CAP`); `--plan` is free. |
| `run-pilot-v2-rewrite.sh` | Keep-or-prune pilot baseline v2: the 5 BAD tasks written again (deepseek-3.2 writes, glm-5 reviews), the other 10 copied byte for byte. Paid (cap 120, at most 4 calls); `--dry-run` is free. |
| `run-prompt-fix-arms.sh` | Konductor prompt-fix study, three arms (vanilla, konductor-adaptive, konductor-coordinator): `--plan` builds and verifies the adaptive arm and batch C's git copy of CardDemo and prints the credit and judge forecast (free); `smoke`, `A`, `B`, `C` are the paid steps with their caps, the per-run credit check and the smoke gate; `judge` is the USD judge pass (read-view rubric, quality pack); `sign-carddemo-key --yes` records the owner's sign-off batch C needs; `rebook --yes` (free) moves the bench pin to a commit with the D-297 meter fix and un-books runs the old v3 estimate stopped under their limit; `reply-check --plan` (free) builds and verifies the candidate arm (fixes 1 to 9 plus P1 and P2) and prints the reply check's calls, `reply-check` (paid, caps 300 credits and USD 0.50) runs 12 early-stopped candidate runs, then the Claude reviewer (`REVIEWER`) and the non-Claude panel on 15 frozen prompts, and writes the side-by-side report in its own folder `$S/reply-check`; `reply-check --repin [--yes]` (free) moves that folder's frozen bench pin to a commit with the D-299 early-stop fix and tops up early stops booked at the floor to their measured spend. Paid. |
| `run-reruns-2.sh` | Second rerun batch of the pilot waves. |
| `run-reruns.sh` | Reruns of the pilot waves whose keys changed. |
| `run-standard-claude.sh` | STANDARD Claude Code step with this host's paths. |
| `run-carddemo-next.sh` | The next two paid CardDemo steps in one command: refresh launchers, wait for load under 4, the non-Claude recheck, then batchday step 1. Paid. |
| `run-standard-judge.sh` | STANDARD judge pass with this host's paths. |
| `run-standard-quality-pack.sh` | Quality-dimensions judge pass over every judged STANDARD v2 unit, then the report with the pack. Paid (USD cap); `--plan` is free. |
| `run-standard-v1.sh` | STANDARD run with this host's paths. |
| `run-tonight.sh` | First unattended command of one night (2026-11-21). |
| `run-wave0-fix.sh` | Finishes wave 0 after budget-skipped runs. |
| `run-waves-after-10.sh` | Waits for a running pilot wave, then runs waves 11 and 12. |
| `sign-arm-r2.sh` | Signs arm release plant-arm-r2 in one command. Free. |
| `sign-arm-release.sh` | Signs the arm release in one command. |
| `standard-kit-env.sh` | This host's paths for the STANDARD wrappers. Sourced, not run. |
| `standard-recheck/bundle.js` | Builds one recheck work dir that holds several tasks. |
| `standard-recheck/prompt.md` | The recheck prompt: four questions per task. |
| `standard-recheck/queue.txt` | The recheck call queue: name, model and tasks per line. |
| `standard-recheck/rc-home.js` | Makes or cleans an isolated kiro-cli HOME. |
| `standard-recheck/results-2026-11-24.md` | Recheck record of the 2026-11-24 queue: 18 tasks cleared, t3-db-order-history blocked. |
| `standard-recheck/run.sh` | STANDARD gate rechecks, one non-Claude call at a time. Paid. |
| `standard-recheck/test-run.sh` | Paid-path test of `run.sh` with a stub kiro-cli. Free. |
| `strands-counted-trial.sh` | One counted Strands plant trial on the real pinned model. Paid. |
| `test-arm-signed-release-v2.sh` | Test of `arm-signed-release-test-v2.sh`. Free. |
| `test-lite-helper-skipped.sh` | Stub test of `lite-helper.js` (D-160). Free. |
| `test-lite-v2-fill.sh` | Test of the LITE v2 budget and fill rules. Free. |
| `test-rebuild-arm-venv.sh` | Stub test of `rebuild-arm-venv.sh` with a fake Python; no download. Free. |
| `test-run-cc-plant-check-v2.sh` | Paid-path test of `run-cc-plant-check-v2.sh`. Free. |
| `test-run-standard-quality-pack.sh` | Stub test of `run-standard-quality-pack.sh`. Free. |
| `test-run-prompt-fix-arms.sh` | Stub test of `run-prompt-fix-arms.sh` with a fake bench.js: plan, smoke gate, coordinator config, run limit, resume, cap, batch C sign-off and soft caps, rebook, judge cap and passes, and the reply check (plan, reviewer check, stub reviewers, rerun, run cap). Free. |
| `test-run-full-suite-twice-v2.sh` | Stub test of `run-full-suite-twice-v2.sh`. Free. |
| `test-run-overnight-stub.sh` | Stub test of `run-overnight.sh`: step order, the stop at a failing step, the give-up after the wait limit. Free. |
| `test-run-fw30-rewrite.sh` | Stub run of `run-fw30-rewrite.sh` on its paid path with the fake kiro-cli. Free. |
| `test-run-pilot-option-b.sh` | Stub run of the 15-task path and option B, at this checkout's head. Free. The suite runs it where `KONDUCTOR_WS` is set (`ops-suite-script.test.js`). |
| `test-run-pilot-v2-rerun.sh` | Paid-path test of `run-pilot-v2-rerun.sh` with the fake kiro-cli. Free. |
| `test-run-pilot-v2-rewrite.sh` | Paid-path test of `run-pilot-v2-rewrite.sh` with the fake kiro-cli. Free. |
| `test-run-pilot-wrappers.sh` | Stub run of the pilot wrappers on their paid paths, at this checkout's head. Free. The suite runs it where `KONDUCTOR_WS` is set. |
| `test-run-wave0-fix.sh` | Test of `run-wave0-fix.sh`. Free. |
| `test-sign-arm-r2.sh` | Test of `sign-arm-r2.sh` with a throwaway key. Free. |
| `test-strands-counted-trial.sh` | Paid-path test of `strands-counted-trial.sh` with stubs. Free. |
| `test-wave0-paid-path.sh` | Regression test of `run-physical-ai-wave0.sh` on its paid path. Free. |

## Scripts from `<workspace>/reports/next-experiment-2026-11-22/` (`bench/ops/next-experiment-2026-11-22/`)

Their data (prefixes, runs, judgments) stays in that reports folder; the scripts find it through `KONDUCTOR_WS`.

| File | What it does |
| --- | --- |
| `run-aa-pack-judge.sh` | FW-38 judge pass of the A/A run, both sets in one pass, then `bench compare --aa vanilla` prints the floor. Paid (USD, cap 2). |
| `run-aa-pack.sh` | FW-38: vanilla twice (set a and set b, one bench run each) on the 8 LITE tasks, 48 runs. Paid (cap 300); the default is a dry run. |
| `cc-team-mode.patch` | D-241: the Claude Code team-mode change (`plugins/claude-code/team-mode.js` and its call in `installInto`) for the frozen bench 69149846. `run-cc-compare.sh` applies it as one commit in its own worktree and checks the tree. Not run. |
| `cc-skill-loads.js` | Which skills each `run-cc-compare.sh` run loaded and whether in full (whole, partial, preload, failed, missing per must-load unit). Free. |
| `cc-team-reuse.js` | Helper of `run-cc-team.sh`: checks the saved Claude Code study is at the new arm's setup (bench commit, claude version, model, seed, effort, replicates, isolation, run cap, arms, all runs a success) and prints each task's saved cc-konductor USD, the expected USD and the judge estimate. Free. |
| `run-cc-compare-judge.sh` | Judge pass of `run-cc-compare.sh`, non-Claude panel, then `report --baseline cc-vanilla`. Paid (USD, cap 2); `--plan` is free. |
| `run-cc-compare.sh` | The forced experiment's 8 tasks on Claude Code: cc-vanilla against cc-konductor (f5d18459, with team mode: `cc-team-mode.patch`), 2 replicates, frozen bench 69149846, 32 runs. Paid (USD, cap 30); the default is a dry run, `--prepare` is free. `CC_MODEL`, `CC_ARMS`, `CC_CAP_USD` and `CC_RUN_CAP_USD` change the model, arms and caps for `run-cc-model-swap.sh`. |
| `run-cc-model-swap.sh` | Claude Code twin of `run-model-swap.sh`: cc-konductor on Sonnet 5.5 (16 runs, cap USD 16; skipped when `run-cc-team.sh`'s team-mode runs exist; `run-cc-compare.sh`'s pre-team study is not reused) and Opus 5.5 (16 runs, cap USD 32), run through `run-cc-compare.sh`; skill loads by `cc-skill-loads.js`. Paid per stage (`--go --stage S`); `--plan`, `--prepare` and `--summary` are free. |
| `run-cc-team.sh` | Second arm of the Claude Code study: cc-konductor-team (f5d18459 with team mode, `cc-team-mode.patch`) on the same 8 tasks, 2 replicates, through `run-cc-compare.sh` under `/var/tmp/cc-team`; the study's 32 runs are reused after `cc-team-reuse.js` checks them. Paid (USD, cap 16; judge cap 1); `--plan`, `--prepare`, `--judge-plan`, `--loads` and `--rescore` are free. |
| `model-swap-summary.js` | Skill-load table of `run-model-swap.sh` per model and arm (task skill loaded, loaded whole, preview only, `find_skills`, "no skill fits", model mismatch), read with `cap nudge-check`'s reader. Free. |
| `model-swap-judge.js` | Helpers of `run-model-swap-judge.sh`: cells that ran, the judge copy with the arm renamed `konductor-opus` (only some replicates with KEEP, for the fill), and the USD estimate from the LITE judge pass. Free. |
| `run-model-swap-judge.sh` | Judge pass of `run-model-swap.sh`'s natural stage: only the 22 Opus runs, non-Claude panel; the Sonnet konductor and vanilla judgments of the LITE pass are reused. Then `report --baseline vanilla` and `--baseline konductor`. Paid (USD, cap 2); `--plan` is free. `--fill` judges only the fill cells of `run-model-swap.sh --fill` (cap USD 0.3), then both reports over the first pass and the fill. |
| `run-model-swap.sh` | Is low skill use a Sonnet 5.5 trait? The plain konductor arm on Opus 5.5 (8 tasks x 3, cap 400), optional list-hook arm on Opus (4 x 3, cap 220) and Fable 5.1 (4 x 2, cap 400), against the reused Sonnet LITE and nudge cells. Paid per stage (`--go --stage S`); the default `--plan` and `--summary` are free. `--fill --go` runs only t1-nfr-report-queries reps 2 and 3, the cells the 400 cap left (cap 138 counted credits); `--fill --plan` is free. |
| `run-forced-aa-r2.sh` | Resume of `run-forced-aa.sh` with the budget fix. Paid. |
| `run-forced-aa.sh` | The forced-skills experiment's two new arms on the frozen LITE bench. Paid. |
| `run-forced-judge.sh` | Judge pass of the forced-skills run. Paid (USD). |
| `run-forced-small-judge.sh` | Judge pass of the focused forced run. Paid (USD). |
| `run-forced-small.sh` | Focused follow-up of the forced run. Paid. |
| `run-nudge-judge.sh` | Judge pass of the nudge-arm run. Paid (USD). `--fill` judges only the fill-stage tasks (cap USD 0.5). |
| `run-nudge.sh` | The nudge-arm run. Paid. `--fill` runs only the 3 cells the 450 cap left budget skipped (cap 60 counted credits); `--fill --plan` is free. |
| `nudge-fill.js` | Fill sets (cells, cells still to run, counted spend at the larger of 15 and each call's credits) for `run-nudge.sh --fill` (set nudge) and `run-model-swap.sh --fill` (set model-swap). Free. |
| `rescore-cc.sh` | Re-scores the Claude Code study's saved runs with the newest task keys (hidden tests and checks only, before and after), into `cc-scores-newest-keys.tsv`. Free. |
| `rescore-table.js` | The per-run TSV `rescore-cc.sh` writes: saved, before and after code scores and hidden counts, with the frozen bench's `scenarios/lib/score.js`. Free. |
| `lib.sh` | The spend and host helpers the paid run scripts here source (`budget_for`, `worst_case`, `wait_host`, `ledger_spent`; D-242). Sourced, never run. |
| `test-run-aa-pack-stub.sh` | Test of `run-aa-pack.sh`'s paid path with a stub bench. Free. |
| `test-run-cc-compare-stub.sh` | Test of `run-cc-compare.sh`'s paid path with a stub bench, of `cc-skill-loads.js` on a made-up stream, and of `cc-team-mode.patch` on the frozen bench. Free. |
| `test-run-cc-team-stub.sh` | Test of `run-cc-team.sh` and `cc-team-reuse.js` (plan and reuse, a reuse mismatch, the new arm only at USD 1 a run, resume, the busy guard, judge, re-score and loads calls) with a stub bench, judge and re-score. Free. |
| `test-run-cc-model-swap-stub.sh` | Test of `run-cc-model-swap.sh` and the `CC_*` overrides of `run-cc-compare.sh` (plan, Opus stage, Sonnet reuse refusal, summary) with a stub bench. Free. |
| `test-run-forced-small-stub.sh` | Test of `run-forced-small.sh`'s paid path with a stub bench. Free. |
| `test-run-model-swap-stub.sh` | Test of `run-model-swap.sh` (plan, paid path, resume, hook miss, counted-credit guard, the `--fill` plan, run, outside-set stop and cap) and of `model-swap-summary.js` with a stub bench. Free. |
| `test-run-model-swap-judge-stub.sh` | Test of `run-model-swap-judge.sh` and `model-swap-judge.js` (plan, paid path, arm rename, resume, USD gate, cap refusal, `--fill` gate, copy of the fill cells only, fill cap) with a stub bench. Free. |
| `test-run-nudge-stub.sh` | Test of `run-nudge.sh`'s paid path with a stub bench, and of its `--fill` stage (plan, the 3 cells only, 60 cap, cells outside the stage, done tasks). Free. The suite runs it where `KONDUCTOR_WS`, the frozen runner, the pinned kiro-cli and the built arms exist. |
| `test-run-nudge-judge-fill.sh` | Test of `run-nudge-judge.sh --fill`'s guards (no .done, cap over USD 0.5). Free. |

## Refactor regression net (`bench/ops/refactor-regression/`)

Free; every agent and judge is a test double. Run from a checkout, no launcher.

| File | What it does |
| --- | --- |
| `run.sh [--base REF] [--head REF] [--report FILE] [--keep]` | Two fresh worktrees under `/var/tmp/kd-refreg.*`; the same studies on base, head and head again; prints the diff. Needs `BENCH_ARM_PYTHON` and `BENCH_STRANDS_PYTHON` for the plant studies. |
| `study.js --tree DIR --out DIR` | One side: Kiro CLI twice with a compare, a stub judge pass, opencode, Claude Code, plant on Claude Code and Strands with plant-report, a report of each run. |
| `diff.js` | Normalises (roots, per-run dirs, times, ids; drops volatile keys, `schemaVersion`, `plugins`, `benchCommit`) and compares two trees. |
| `report.js --base --head [--noise]` | The markdown; a difference that also shows between two head runs is marked noise. |

## Quiet host for a counted plant run (`bench/ops/quiet-host/`)

Run from a checkout in the owner's own terminal, no launcher. Steps, flags and the EC2 fallback are in
[its README](quiet-host/README.md) (D-95).

| File | What it does |
| --- | --- |
| `Dockerfile` | Amazon Linux 2023 with Node 22, Python 3.12 and cedarpy 4.12.2, and the owner's uid; nothing private in it. |
| `quiet-host.sh print\|build\|start\|login\|check\|wave N\|shell\|stop` | The container: own network, no published port, not privileged; mounts the checkout, the counted set, the normal tasks, the wave dir and the pinned kiro-cli. `check` is free: the sandbox probe and `plant-host-check`. |
| `test-quiet-host.sh` | Test of `quiet-host.sh` with a stub docker (refusals; no port, host network or privileged mode; the mounts; `check` and `wave`). Free. |

## Konductor prompt-fix arms (`bench/ops/prompt-fixes/`)

Used by `workspace/run-prompt-fix-arms.sh`; all free. The spec is `reports/konductor-prompt-fixes-2026-11-27.md` in the
owner workspace; konductor's own source is never edited, the arm carries the text.

| File | What it does |
| --- | --- |
| `edits.js` | The text edits of Fixes 1 to 9 against konductor c042c7ba, in order, the reply-check edits P1 and P2 (`REPLY_EDITS`), and the files the arm replaces or adds. |
| `build-candidates.js --repo R --out DIR [--with p1p2]` | Applies the edits (each `before` must be found exactly once), writes the files under DIR and prints the `cap variant` ops; `--with p1p2` adds P1 and P2 for the reply-check candidate arm. |
| `study.js cells\|forecast\|spent\|usd-spent\|may-start\|judge-may-start\|gate` | The study's steps, caps and per-run limits, the credit and judge forecast, the credit and USD checks before each run and the smoke gate. |
| `reply-check.js score\|prompts\|plan\|may-run\|rebook-early\|review\|compare` | The reply-format diagnostic of the adaptive arm: `score --runs DIR` checks E1 to E7 (Plan line, before the first write or spawn, the expected solo or team word, Skills line, writer spawns, last line `Review gate:`, reviewer) from each run's stream with no model; `prompts` freezes the one reviewer prompt per run that the Claude reviewer and the non-Claude panel both read (with `manifest.json`); `plan` prints the paid call count and cost; `may-run` is the cap check before each early-stopped run. `rebook-early --runs DIR [--apply yes]` tops up an early stop an older bench booked at the floor to its session's measured creditSplit (D-299). `review` is PAID: one Claude call (counted at max(15, real)) and one call per panel judge (USD) per prompt, each checked against its ledger first. `compare` writes both reviewers side by side, the panel majority as the verdict, every disagreement flagged. |
| `reply-review.js` | The paid half of `reply-check.js` (`review` and `compare`, called through it): the ledger checks before each Claude and panel call, one retry of an unreadable reply, and the side-by-side report. |
| `carddemo-git.js --bench B --out DIR` | Batch C's copy of cx-carddemo-batchday with a git-initialised fixture (no answer key in its history); hidden tests and goldens copied byte for byte and checked. |
