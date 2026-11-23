<!-- SPDX-License-Identifier: Apache-2.0 -->
# Paid steps: what each costs, and its cap

2026-11-23. [← bench home](../README.md) · [safety and caps](safety-and-caps.md) · [owner scripts](../ops/README.md)

**The problem.** Paid work runs from many scripts, each with its own cap, unit and log. Before you approve one, you
need its cost and cap on one line.

**The rule.** Every paid step is approved first, with a cap. Each script below has a free `--dry-run` (or
`--plan`, `--prepare-only`) that prints the plan and makes no call. A step stops at its cap, and the same command
resumes it. How each cap is counted is in [safety and caps](safety-and-caps.md).

## The steps waiting on the owner

Run each from `<workspace>/scripts/` (launchers into [bench/ops](../ops/README.md)).

| Step | Script | Expected cost | Cap |
| --- | --- | --- | --- |
| Keep-or-prune pilot rerun, controls only | `run-pilot-rerun.sh` | 120 calls, about 21 real credits | 1,800 counted (15 a call) |
| Keep-or-prune pilot, the unit (after both controls pass) | `run-pilot-rerun.sh --unit` | 225 calls, about 40 real credits | 3,375 counted (`UNIT_CAP`; 3,390 approved for the resume after one killed call) |

**A resume after a killed call.** A call killed mid-flight (a restart, a closed host) keeps its 15-credit
reservation, but its reply is lost, so the resume makes it again. That call is counted twice. So a resume needs the
cap raised by 15 for each killed call, with the owner's approval: for example
`UNIT_CAP=3390 bash scripts/run-pilot-rerun.sh --unit` (`CONTROLS_CAP` for the controls part). The dry run's gate 4
shows whether it fits.
| Keep-or-prune pilot baseline v2: the 5 BAD tasks written again | `run-pilot-v2-rewrite.sh` | at most 4 calls, about 1 real credit | 120 counted (at most 60 used) |
| Keep-or-prune pilot baseline v2: one last try at t09 (no fix; a fail drops it) | `run-pilot-v2-rewrite.sh --redo t09` | 2 calls | inside the same 120 counted |
| Keep-or-prune pilot rerun on baseline v2 (after the rewrite, its review and sign-off) | `run-pilot-v2-rerun.sh` | 215 new calls, about 33 real credits | 3,240 counted (`UNIT_CAP`) |
| STANDARD gate rechecks | `standard-recheck/run.sh` | 7 calls, about 10 real credits | 105 counted |
| STANDARD stages A and B | `run-standard-v1.sh` (once per stage) | about 707 real credits a stage | 800 real credits a stage |
| STANDARD judges | `run-standard-judge.sh` | about USD 5 | USD 15 |
| STANDARD on Claude Code, 15 tasks | `run-standard-claude.sh` | about USD 20 | USD 1 a run, USD 30 in all |
| First real Claude Code plant check | `run-cc-plant-check-v2.sh` | 2 trials | USD 1 a trial, USD 2 in all |
| One counted Strands plant trial | `strands-counted-trial.sh --cap-usd N` | one trial on the pinned Bedrock model | the `N` you approve |

Every owner script, paid or free, is listed in [bench/ops/README.md](../ops/README.md). The run levels' caps are in
[run levels](run-levels.md). An unattended run from the [runbook](runbook.md) takes its cap from `BUDGET_CREDITS`,
which every call that runs the preflight needs.

## Where results live

Each script prints where it writes. For example: runs and records under a work dir in `/var/tmp/konductor-<step>/`
(outside the home folder), and the log and any copied record under `<workspace>/reports/<step>-<time>/`. A bench
command you run yourself writes under the `--out DIR` you give it.
