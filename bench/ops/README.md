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
| `arm-signed-release-test.sh` | Superseded by `arm-signed-release-test-v2.sh`. |
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
| `run-full-suite-twice-v2.sh` | KR k485f5870: two full suite runs through `bench/scripts/test.sh --tap`, then the reading. Free. |
| `run-full-suite-twice.sh` | Superseded by `run-full-suite-twice-v2.sh`. |
| `run-fw30-rewrite.sh` | FW-30: the pilot tasks written again from `briefs-fw30.json`, deepseek-3.2 writes, glm-5 reviews. Paid (cap 120); `--dry-run` is free. |
| `run-lite-judge.sh` | Judge pass of the LITE konductor-against-plain run. Paid (USD). |
| `run-lite-konductor-v2.sh` | LITE konductor-against-plain run, v2. Paid. |
| `run-lite-konductor.sh` | LITE konductor-against-plain run, v1. Paid. |
| `run-lite-rejudge.sh` | Re-judge of the LITE run with the unquoted-evidence re-ask. Paid (USD). |
| `run-morning.sh` | Third unattended command of one night (2026-11-21). |
| `run-namespace-test-v2.sh` | DEBT D-165 second try: the namespace case with a Python that has pytest. |
| `run-namespace-test.sh` | DEBT D-165: only the namespace case of `real-run.test.js` on the origin head. |
| `run-physical-ai-wave0.sh` | Physical AI wave 0 in one command. |
| `run-pilot-author.sh` | Keep-or-prune pilot step 1: writes the tasks. Paid. |
| `run-pilot-freeze.sh` | Keep-or-prune pilot step 2: freezes the read draft. Free. |
| `run-pilot-replace.sh` | Keep-or-prune pilot option B: replaces one task. Paid. |
| `run-pilot-run.sh` | Keep-or-prune pilot step 3: the quick run. Paid. |
| `run-pilot-rerun.sh` | Keep-or-prune pilot step 3 again after pilot 1: controls only (cap 1,800), then `--unit` (cap 3,375). Paid. |
| `run-pilot-v2-rerun.sh` | Keep-or-prune pilot rerun on baseline v2 with the FW-36 role line on both unit arms; needs the v2 sign-off and the Fable review mark (or `--skip-fable-review`). Paid (cap 3,240, `UNIT_CAP`); `--plan` is free. |
| `run-pilot-v2-rewrite.sh` | Keep-or-prune pilot baseline v2: the 5 BAD tasks written again (deepseek-3.2 writes, glm-5 reviews), the other 10 copied byte for byte. Paid (cap 120, at most 4 calls); `--dry-run` is free. |
| `run-reruns-2.sh` | Second rerun batch of the pilot waves. |
| `run-reruns.sh` | Reruns of the pilot waves whose keys changed. |
| `run-standard-claude.sh` | STANDARD Claude Code step with this host's paths. |
| `run-standard-judge.sh` | STANDARD judge pass with this host's paths. |
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
| `standard-recheck/run.sh` | STANDARD gate rechecks, one non-Claude call at a time. Paid. |
| `standard-recheck/test-run.sh` | Paid-path test of `run.sh` with a stub kiro-cli. Free. |
| `strands-counted-trial.sh` | One counted Strands plant trial on the real pinned model. Paid. |
| `test-arm-signed-release-v2.sh` | Test of `arm-signed-release-test-v2.sh`. Free. |
| `test-arm-signed-release.sh` | Superseded by `test-arm-signed-release-v2.sh`. |
| `test-lite-helper-skipped.sh` | Stub test of `lite-helper.js` (D-160). Free. |
| `test-lite-v2-fill.sh` | Test of the LITE v2 budget and fill rules. Free. |
| `test-rebuild-arm-venv.sh` | Stub test of `rebuild-arm-venv.sh` with a fake Python; no download. Free. |
| `test-run-cc-plant-check-v2.sh` | Paid-path test of `run-cc-plant-check-v2.sh`. Free. |
| `test-run-full-suite-twice-v2.sh` | Stub test of `run-full-suite-twice-v2.sh`. Free. |
| `test-run-fw30-rewrite.sh` | Stub run of `run-fw30-rewrite.sh` on its paid path with the fake kiro-cli. Free. |
| `test-run-full-suite-twice.sh` | Superseded by `test-run-full-suite-twice-v2.sh`. |
| `test-run-pilot-option-b.sh` | Stub run of the 15-task path and option B. Free. |
| `test-run-pilot-v2-rerun.sh` | Paid-path test of `run-pilot-v2-rerun.sh` with the fake kiro-cli. Free. |
| `test-run-pilot-v2-rewrite.sh` | Paid-path test of `run-pilot-v2-rewrite.sh` with the fake kiro-cli. Free. |
| `test-run-pilot-wrappers.sh` | Stub run of the pilot wrappers on their paid paths. Free. |
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
| `cc-skill-loads.js` | Which skills each `run-cc-compare.sh` run loaded and whether in full (whole, partial, preload, failed, missing per must-load unit). Free. |
| `run-cc-compare-judge.sh` | Judge pass of `run-cc-compare.sh`, non-Claude panel, then `report --baseline cc-vanilla`. Paid (USD, cap 2); `--plan` is free. |
| `run-cc-compare.sh` | The forced experiment's 8 tasks on Claude Code: cc-vanilla against cc-konductor (f5d18459), 2 replicates, frozen bench 69149846, 32 runs. Paid (USD, cap 30); the default is a dry run, `--prepare` is free. |
| `run-forced-aa-r2.sh` | Resume of `run-forced-aa.sh` with the budget fix. Paid. |
| `run-forced-aa.sh` | The forced-skills experiment's two new arms on the frozen LITE bench. Paid. |
| `run-forced-judge.sh` | Judge pass of the forced-skills run. Paid (USD). |
| `run-forced-small-judge.sh` | Judge pass of the focused forced run. Paid (USD). |
| `run-forced-small.sh` | Focused follow-up of the forced run. Paid. |
| `run-nudge-judge.sh` | Judge pass of the nudge-arm run. Paid (USD). |
| `run-nudge.sh` | The nudge-arm run. Paid. |
| `test-run-aa-pack-stub.sh` | Test of `run-aa-pack.sh`'s paid path with a stub bench. Free. |
| `test-run-cc-compare-stub.sh` | Test of `run-cc-compare.sh`'s paid path with a stub bench, and of `cc-skill-loads.js` on a made-up stream. Free. |
| `test-run-forced-small-stub.sh` | Test of `run-forced-small.sh`'s paid path with a stub bench. Free. |
| `test-run-nudge-stub.sh` | Test of `run-nudge.sh`'s paid path with a stub bench. Free. |

## Refactor regression net (`bench/ops/refactor-regression/`)

Free; every agent and judge is a test double. Run from a checkout, no launcher.

| File | What it does |
| --- | --- |
| `run.sh [--base REF] [--head REF] [--report FILE] [--keep]` | Two fresh worktrees under `/var/tmp/kd-refreg.*`; the same studies on base, head and head again; prints the diff. Needs `BENCH_ARM_PYTHON` and `BENCH_STRANDS_PYTHON` for the plant studies. |
| `study.js --tree DIR --out DIR` | One side: Kiro CLI twice with a compare, a stub judge pass, opencode, Claude Code, plant on Claude Code and Strands with plant-report, a report of each run. |
| `diff.js` | Normalises (roots, per-run dirs, times, ids; drops volatile keys, `schemaVersion`, `plugins`, `benchCommit`) and compares two trees. |
| `report.js --base --head [--noise]` | The markdown; a difference that also shows between two head runs is marked noise. |
