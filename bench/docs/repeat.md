# How to repeat a run

[← bench home](../README.md) · New to bench? Start with [repeat it yourself](repeat-it-yourself.md), the short path
from a clone to a first result. This page is the full kit for the 2x2 study: pinned binaries, freeze, gates and caps.

This page is the exact path to repeat the konductor 2x2 study from this repository: build the konductor commit, freeze
it, run the free checks, run each paid stage under its cap, judge, report, and re-score at other time limits. It ends with
the three run levels (LITE, STANDARD, FULL) and says which of their pieces exist. Anything that does not exist yet is
marked **not built yet**.

The scripts are in [kit/](../kit/README.md). Every command below runs from your own terminal, not from an agent shell: the
paid stages need the sandbox (`unshare`) and spend credits or dollars. **A paid stage starts only after the owner has
approved its cap.** The caps written in the scripts are the ones approved for the first study and the Kiro-only rerun
(table in [Spend and caps](#spend-and-caps)). Another run needs a new approval, then a change to the `CAP` lines in your
copy of the kit and nothing else.

## What you need

| Item | Detail |
| --- | --- |
| Host | Linux with user namespaces (`unshare -Urm true` works), `flock`, 8 GB free memory, 15 GB free under `/var/tmp`, load under half the cores |
| Tools | Node 22+, git, `tmux` (for unattended runs), the AWS CLI, `opencode` 1.19.5 (the judge backend), `python3` |
| Pinned binaries | `kiro-cli` 3.5.0 (sha256 `e1bf38eb89e06d90ffb872565f3f191590e148c2da0b68e5d5ac31b7ca49a70e`) and Claude Code 2.1.327.1766 (sha256 `343c744baa14bfd38286a7cb90871051f04379956da6c5b803a9e66019a76ac9`). The kit checks both |
| Python 3.12 | The Kiro-only rerun needs `python3` and `python` on `PATH` to be 3.12. The first study ran on 3.9 and every run logged "expected 3.12". The two studies are not pooled |
| Logins | `kiro-cli login`, and an AWS profile for Bedrock. Use a least-privilege profile, never admin |
| Bench commit | Every bench commit the kit relies on is in `feat/bench-pilot-nk`: Claude Code `--effort` passed through, the median of three judges, `startup.json` per run, `--prepare-only` that makes a real run's checks. The kit's `preconditions` step refuses a bench that lacks them |

## 1. Set up the directories

Four paths, all of your choosing. Keep `S` under `/var/tmp` and its path free of the word "bench".

```bash
C=/path/to/konductor-clone            # the clone that holds the build ref (step 2) and bench
S=/var/tmp/study-a                    # the study directory: freeze.env, runs, reports, logs
R=/var/tmp/study-a-worktree           # a dedicated worktree of C; freeze checks out the bench commit in it
K=$S/kit                              # a COPY of the kit, outside R

git -C $C fetch origin main feat/bench-pilot-nk
git -C $C worktree add --detach $R origin/feat/bench-pilot-nk
mkdir -p $S && cp -r $R/bench/kit/2x2 $K

# the pinned binaries, in the layout the kit expects
mkdir -p $S/bin/kiro-cli-3.5.0 $S/bin/claude-code/2.1.327.1766
cp /path/to/kiro-cli   $S/bin/kiro-cli-3.5.0/kiro-cli
cp /path/to/claude     $S/bin/claude-code/2.1.327.1766/claude

# Kiro-only rerun: python3 and python must be 3.12
mkdir -p $S/pybin && ln -sf /path/to/python3.12 $S/pybin/python3 && ln -sf /path/to/python3.12 $S/pybin/python

export S R AWSP=<the NAME of your AWS profile>
```

The kit must run from `$K`, not from inside `$R`: `freeze` replaces the files of `$R`. The kit refuses to start from
inside `$R`. To reuse the binaries and the arm cache of an earlier study, set `SHARED` to that study's directory.

## 2. Build the konductor commit

The study tests one konductor commit, `COMMIT`. When the change under test is not merged, build it as a local branch that
is never pushed, record its SHA, and use that SHA as the only variable.

```bash
git -C $C switch -c integration/study-a origin/main           # a new local branch from main
git -C $C merge --no-ff <head of the first PR>                  # one merge per PR; resolve conflicts, keep both changelog entries
git -C $C merge --no-ff <head of the next PR>
for h in <every PR head and the main commit>; do                # every head must be an ancestor of the build
  git -C $C merge-base --is-ancestor $h integration/study-a && echo "ok $h"
done
COMMIT=$(git -C $C rev-parse integration/study-a)               # write this SHA down: it is the commit under test
node $K/listing-check.js $C $COMMIT                              # free: no konductor skill may be name-only on Claude Code
```

`listing-check.js` exits 0 when every konductor skill keeps its description in the Claude Code skill listing (budget
30,000 characters for Sonnet 5.5) and 1 otherwise. The kit's `freeze` runs it again and refuses a commit that fails. It is
a static estimate from the git tree; the measured install was 58 characters off. To check against the real listing, install
the build into a scratch project and run `claude -p '/context'` there (free, no model call).

Builds used so far (local branches, never pushed, so the SHAs resolve only in the clone that made them; debt row D-48):

| Study | Branch | Commit | Contents |
| --- | --- | --- | --- |
| First study (short run) | `integration/2x2-local` | `7c0375c49f8b15b4ff171e3cae35c2aed16fc7d0` | `origin/main` at `05360b8c` plus the head of PR #303 (`7c0375c4`, which holds #302 `bded9ce7` and #299 `7ff6c981`) |
| Kiro-only rerun | `integration/2x2-local-v2` | `eaf87a6beace4399baa9e420f2a6ec77a9c9d80b` | the build above plus PR #312 at `fc452e64` (the merge conflicted only in `CHANGELOG.md` and `docs/site/.user-guide.manifest`) |

A result carries the build label and the SHA. Labels used: "pre-merge integration build (main + #302/#299/#303)" and
"pre-merge integration build (main + #302/#299/#303 + Kiro skill-access fix)".

## 3. Free checks

None of these calls a model or spends anything. `check` and `freeze` need AWS and the Kiro login.

```bash
bash $K/run-2x2.sh split-check     # recompute the SR-32 split; refuses an edited DEV or HELD-OUT list
bash $K/run-2x2.sh check           # pins, split, quiet host, sandbox, Kiro login and model, opencode, Bedrock models, three judge families, preconditions
export KONDUCTOR_REF=integration/study-a
export BUILD_LABEL='pre-merge integration build (main + <your PRs>)'
bash $K/run-2x2.sh freeze          # records COMMIT and BENCH_SHA in $S/freeze.env; refuses a commit with a name-only skill; checks out BENCH_SHA in $R
cat $S/freeze.env                  # COMMIT must be the build from step 2
bash $K/run-2x2.sh prepare         # builds both konductor arms from COMMIT inside the sandbox
bash $K/run-2x2.sh missing         # the planned cells that have no result yet
```

For the Kiro-only rerun use `$K/run-2x2-kiro.sh` for every command in this page, with the same names. It has no `smoke`.
After `freeze`, `prepare` must show no "toolchain: python3 is ..." warning.

The SR-32 split is fixed before any run: a task is DEV when `sha256("konductor-2x2 SR-32 split v1:" + id)`, first 8 hex
digits as a number, is divisible by 3; otherwise HELD-OUT. DEV is for tuning and is never the verdict.

## 4. Judge plan and gate

`judge-plan` prints the number of judge calls and the estimated spend and calls no model. `gate` reads saved results and
stops the study on a model mismatch, tampering, a konductor skill loaded in a vanilla arm, more than 10% infra errors, more
than 30% timeouts, an effort level other than `high`, a Claude Code listing that cuts a konductor skill, or a startup record
that differs from the owner's startup rule (default agent or konductor, no extra MCP server, nothing from the real home).

```bash
bash $K/run-2x2.sh judge-plan 1     # free
bash $K/run-2x2.sh gate 1           # free; exit 1 means STOP: do not start the next stage
```

Read the NO DATA runs, the judge seats and the pairwise order flips (25% limit) in the reports as well.

## 5. The paid stages

Set `ACK_CC_VERSION=1` only after the smoke run passed. Stages resume with the same command: finished cells are kept.
`RESUME_ERRORS=1` also reruns errored cells (read their `stderr.txt` first).

First study (Kiro CLI and Claude Code):

```bash
bash $K/run-2x2.sh smoke                 # PAID, about $0.5. Then: export ACK_CC_VERSION=1
bash $K/run-2x2.sh stage1 kiro           # PAID, credits   } may run at the same time
bash $K/run-2x2.sh stage1 cc             # PAID, USD       } in two terminals
bash $K/run-2x2.sh judge-plan 1 && bash $K/run-2x2.sh judge 1 && bash $K/run-2x2.sh report 1 && bash $K/run-2x2.sh gate 1   # DEV
# stop here: the owner approves stage 2
bash $K/run-2x2.sh stage2 kiro; bash $K/run-2x2.sh stage2 cc
bash $K/run-2x2.sh judge-plan 2 && bash $K/run-2x2.sh judge 2 && bash $K/run-2x2.sh report 2 && bash $K/run-2x2.sh gate 2   # HELD-OUT, the verdict
```

A short stage 2 for a first look: `HELD_SUBSET="hard-export-formats,rc-threat-model design-hold-service,review-inventory-security sdlc-spike-dedupe" HELD_REPS=2`
(batches split by spaces). Its result is a partial HELD-OUT set and is reported as such.

Kiro-only rerun:

```bash
bash $K/run-2x2-kiro.sh stage3 kiro      # PAID, 17 tasks x 3 replicates x 2 arms, replicate by replicate, 1800 s limit
bash $K/run-2x2-kiro.sh judge-plan       # free
bash $K/run-2x2-kiro.sh judge            # PAID, three judges, median
bash $K/run-2x2-kiro.sh report           # tables, fractional-scoring table, build label, timelines, re-score by limit
bash $K/run-2x2-kiro.sh gate             # free
```

Unattended: `tmux new -d -s k2x3 "env PATH=$PATH S=$S R=$R AWSP=$AWSP KONDUCTOR_REF=$KONDUCTOR_REF BUILD_LABEL='$BUILD_LABEL' CREDS_UNTIL='<time your AWS credentials end>' bash $K/overnight-kiro.sh"`.
Look in with `bash $K/overnight-kiro.sh --status`. `--dry-run` prints the steps and runs only free checks. It never retries a
paid step; the first failure writes `$S/overnight.STOPPED`. `overnight.sh` does the same for the first study after stage 1.

### Spend and caps

| Study | Step | Cap | Source of the approval |
| --- | --- | --- | --- |
| First study | smoke | $1 | owner, 2026-11-18 |
| | stage 1 (DEV) | 80 credits, $13 Claude Code, $7 judging | same, 520 credits and $151 in all |
| | stage 2 (HELD-OUT) | 440 credits, $90 Claude Code, $40 judging | same |
| Kiro-only rerun | stage 3 | soft cap 390 credits and $20 judging; ceiling 396 credits and $129 | owner, 2026-11-19 |
| PR #312 probe | 12 runs | soft cap 40 credits, ceiling 60 | per run, from the owner |

The run warns at 90% of a soft cap and goes on; it stops at the ceiling. Each Claude Code run has its own USD cap
(`RUN_CAP_USD`, $3 in the kit).

## 6. Re-score at other time limits, and timelines

The Kiro-only `report` writes both. By hand, on any finished run directory (read only, free):

```bash
BENCH_ROOT=$R/bench node $K/rescore-by-limit.js --run $S/rerun/kiro --baseline vanilla --variant konductor \
  --limits 600,1200,1800 --extra-tasks $R/bench/rootcause,$R/bench/sdlc --out $S/report-rerun-kiro/rescore-by-limit.md
python3 $K/timeline.py --run $S/rerun/kiro --min-sec 600 --out $S/report-rerun-kiro/timelines
```

`rescore-by-limit.js` counts every run over a limit T as a timeout and shows konductor minus vanilla in three treatments:
`asis` (the run keeps its score), `drop` (the run is removed) and `zero` (the run scores 0), with a 95% t-interval over
tasks. Unchanged, it equals the report. It is not the verdict; the verdict comes from `report`.
`timeline.py` writes one page per run over the limit: tool calls, skill loads, delegations with start and end, idle gaps of
45 s or more, credits over time (Kiro) and the last five minutes.

## 7. Run levels: LITE, STANDARD, FULL

Three levels share one pack, one scorer and one report. They differ in how many tasks, arms, runs and judges they use.
Only FULL is pre-registered, and only FULL may give a verdict. This table is the definition (owner decision, 2026-11-19).

| | LITE | STANDARD | FULL |
| --- | --- | --- | --- |
| Purpose | quick smoke of the harness, the tasks and a stratified sample; run after every harness, task or konductor change | between LITE and FULL; the only level where tuning is allowed | the pre-registered verdict run; tests every skill, SOP and agent |
| Tasks | about 16 stratified DEV tasks, plus every task added or changed since the last LITE | all DEV tasks, about 50 | the whole pack, 150 to 200; verdicts from HELD-OUT only |
| Arms | `konductor` against a stored `vanilla` baseline | `vanilla`, `konductor`, `konductor-noskills` | the same three, plus a drop-one arm per unit and a forced-load arm for units that load in under 50% of runs |
| Harness | Kiro CLI | Kiro CLI; Claude Code on 15 tasks, one run each | Kiro CLI and Claude Code |
| Runs | 1 per task | 2 per arm per task | 3 per arm per task; 5 per side on each unit's 3 effect tasks |
| Scoring | code-scored parts only; no judge calls | code parts plus the three-judge rubric (median) | the same, after a person's 40-output calibration |
| Cost (estimate) | about 80 credits | about 1,500 credits, $20 Claude Code, $40 judges | about 19,500 credits and $1,400 |
| May support | no regression seen on these tasks; a skill that fails to load; a broken task | direction per phase and role, labelled "DEV, not a verdict" | "beats by the margin", "beats", "ties", "loses", "unsettled"; keep-or-prune verdicts signed off by a person |
| May not support | any comparison beyond the stored baseline; any verdict | any verdict or margin claim | claims beyond one model and the pack version |

Where each level stands today, and how to run it, is in [run-levels.md](run-levels.md). The 2x2 study above is still
the one study this page repeats end to end. Do not describe any other run as LITE, STANDARD or FULL.

## 8. The PR #312 probe

Twelve short prompts, each needing one skill that was unreachable before PR #312, none naming it. Steps and cost are in
[kit/probes/pr312-skill-access/README.md](../kit/probes/pr312-skill-access/README.md).

## Host rules

Other builders run test suites on the same host. While any kit stage runs, pause: full test suites, sandbox tests, any other
`bench.js run`, `judge` or `cap` study, `cargo build`, installing kiro-cli or Claude Code, and merges to konductor `main`
(the kit stops at its next command unless `ALLOW_MAIN_MOVED=1`). Anyone starting a heavy job takes the lock exclusively:

```bash
flock -x /var/tmp/konductor-heavy.lock node --test --test-concurrency=1 <test files>
```

The kit takes it shared, so its Kiro and Claude Code stages can run side by side. The kernel drops the lock when its
holder exits.

## Test the kit

```bash
TMPDIR=$(mktemp -d /tmp/kbench-kit.XXXX) flock -x /var/tmp/konductor-heavy.lock \
  node --test --test-concurrency=1 bench/runner/test/kit-2x2.test.js bench/runner/test/kit-tools.test.js
```

They check syntax (and `shellcheck` when installed), the free commands, the refusals that fire before anything is spent,
`gate` on fake results, and the helpers on small fixtures. They start no model, no cloud call and no sandbox. Remove the
temp dir afterwards.

## After the study

Keep `freeze.env`, the reports with their `BUILD.txt`, and the run directories you need (`bench.js archive` shrinks a run
and keeps it re-scorable). Remove the worktree with `git -C $C worktree remove $R` and the pinned copies under `$S/bin`
and `$S/cache` when you are done.
