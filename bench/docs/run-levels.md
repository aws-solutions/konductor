<!-- SPDX-License-Identifier: Apache-2.0 -->
# Run levels: LITE, STANDARD and FULL

[← bench home](../README.md) · [how Konductor is benchmarked](konductor-bench.md) · [scoring](scoring.md) ·
[safety and caps](safety-and-caps.md)

**The problem.** A study of Konductor can run a handful of tasks or the whole pack, one arm or three, with or
without judges. Calling a small run a verdict is the easiest way to mislead. So bench defines three levels, and only
the largest one may say who wins.

## The three levels

| | LITE | STANDARD | FULL |
| --- | --- | --- | --- |
| Use it for | a quick check after any change | a broader look; the only level where tuning is allowed | the pre-registered verdict |
| Tasks | about 16: one DEV task per phase, plus a twin and a control, plus every task changed since the last LITE | every DEV task that passes its gate (43 of 61 on 2026-11-23) | the whole pack; the verdict from HELD-OUT tasks only |
| Arms | `konductor` against `vanilla` | `vanilla`, `konductor`, `konductor-noskills` | the same three, plus a drop-one arm per unit and a forced-load arm for units that load in under half of their runs |
| Runtime | Kiro CLI | Kiro CLI, plus Claude Code on 15 tasks | Kiro CLI and Claude Code |
| Runs | 1 per task | 2 per arm per task | 3 per arm per task |
| Scoring | code-scored parts only | code parts plus the three-judge rubric | the same, after a person's calibration of 40 outputs |
| May say | "no regression seen", "this skill failed to load", "this task is broken" | a direction, labelled "DEV, not a verdict" | one verdict word ("beats by the margin", "beats", "ties", "loses", "loses by the margin", "unsettled"), and keep-or-prune evidence per unit, signed off by a person |
| May not say | any comparison beyond the stored baseline; any verdict | any verdict or margin claim | anything beyond one model and the pack version |
| Expected cost | about 80 credits | about 1,400 real credits (two stages of about 707), about USD 5 of judges, about USD 20 of Claude Code | about 19,500 credits and USD 1,400 |
| Caps | the `--budget-credits N` you give | 800 real credits per stage (1,600 in all), USD 15 for judges, USD 30 for Claude Code (USD 1 a run) | not set yet |

The definition is the owner's decision of 2026-11-19. The STANDARD numbers are the kit's defaults
(`STAGE_CAP`, `CAP_USD` in `bench/kit/standard/`) and the owner's approval sheet of 2026-11-23. This is the one
table of run levels; other pages link here. `run --level lite|standard|full` picks a suite's tasks by
level; FULL also needs `--prereg FILE`, the frozen pre-registration lock.

> [!WARNING]
> `--suite lite` is an older five-task suite, not the LITE level.

## Where each level stands (2026-11-23)

| Level | State |
| --- | --- |
| LITE | ran on 2026-11-21 (konductor against vanilla on Kiro CLI); its results are a check, not a verdict |
| STANDARD | the kit is built and tested on stubs (`bench/kit/standard/`); not run yet |
| FULL | not run. The pre-registration lock is not frozen, and the person's 40-output calibration is not done |

No verdict has been published. Do not describe any other run as LITE, STANDARD or FULL.

## How to run each level

Each level runs from your own terminal, never from an agent shell: the paid stages need the sandbox (`unshare`).
Each script has a free first step that makes no model call.

| Level | Command | Free first step |
| --- | --- | --- |
| LITE | `node bench/runner/bench.js run --suite pack --level lite --arms vanilla,main --budget-credits N --out OUT` | the same with `--prepare-only` |
| STANDARD | `S=<study dir> R=<konductor worktree> KBIN=<kiro-cli 3.5.0> bash bench/kit/standard/run-standard.sh`, then `judge-standard.sh` and `claude-standard.sh` | `run-standard.sh --prepare-only`, `judge-standard.sh --plan` |
| FULL | not packaged yet | `scenarios prereg` freezes and checks the lock (see the [reference](reference.md)) |

[`bench/kit/README.md`](../kit/README.md) lists every kit script, its needs and its caps. [Repeat it
yourself](repeat-it-yourself.md) walks a first small run, and [safety and caps](safety-and-caps.md) explains the
budgets.
