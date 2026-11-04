# Design note: the 2x2 pilot (harness by konductor)

Status: the pilot is built and tested with fakes; it has not been run against real services. How to run it is in
[README.md](README.md#2x2-pilot). This note records what the pilot measures, what it cannot, and how the pieces fit.

## The question

Two factors on one model:

|  | konductor off (`vanilla`) | konductor on (`konductor`) |
| --- | --- | --- |
| **Kiro CLI** | cell `kiro-vanilla` | cell `kiro-konductor` |
| **Claude Code** | cell `cc-vanilla` | cell `cc-konductor` |

Does konductor change quality and cost, and does that change depend on the harness? The pilot has two jobs: measure the
real cost of each cell, and prove the pipeline end to end (run, judge, combine). It is not a statistical study.

## What is held fixed

- **Model.** Kiro runs `claude-sonnet-5.5` on engine `v3`; Claude Code runs `us.anthropic.claude-sonnet-5-5`. Both reduce to
  the canonical name `claude-sonnet-5-5`; the combiner refuses cells whose canonical names differ.
- **Konductor source.** Both konductor arms are built from one commit (`--konductor-ref`, default `bf07556f9f73`, the main
  commit that carries the dashed model pins Claude Code needs). The pilot branch differs from that commit only under
  `bench/`, which the install does not use. The combiner compares the recorded commit of the two konductor cells and refuses a
  mismatch.
- **Tasks.** Five lite tasks: `simple-fix-failing-test`, `simple-explain-file`, `orch-input-validation`,
  `review-inventory-security`, `design-hold-service`. `design-hold-service` hit the 600 s limit in many earlier Kiro konductor
  runs. It stays in; a timeout is scored on what the run produced, marked in the table, and shown again with timeouts
  excluded.
- **Judging.** One panel for all four cells (`gpt-5.6-luna`, `deepseek-3.2`, `glm-5` through opencode on Bedrock), rubric mode
  only, no cross-cell pairwise comparison. Each cell is judged on its own against the task rubric, so the scores are absolute
  and comparable across cells. The combiner refuses cells judged by different panels, backends, Bedrock model ids or rubric
  revisions.

## Units

Quality is a 0 to 100 score, the repository formula (hidden tests 0.5, checks 0.2, rubric 0.3, renormalised over the parts a run
has). It is compared across all four cells.

Cost is credits on Kiro and list-price USD on Claude Code. The two are never compared. Cost appears only as a ratio of
konductor over vanilla inside one harness, per run and per successful run. A ratio is marked `>=`, `<=` or `~` when timed-out
runs left a side without a metered cost.

## The decomposition

From the per-task mean quality of each cell, paired by task:

| Contrast | Meaning |
| --- | --- |
| konductor effect in Kiro CLI | `kiro-konductor` minus `kiro-vanilla` |
| konductor effect in Claude Code | `cc-konductor` minus `cc-vanilla` |
| harness effect, vanilla | `cc-vanilla` minus `kiro-vanilla` |
| harness effect, konductor | `cc-konductor` minus `kiro-konductor` |
| interaction | Claude Code konductor effect minus Kiro CLI konductor effect |

The table also shows success rate, timeouts, errors, delegation (spawns per run and the share of runs that delegated) and the
model identity check (Claude Code canonical-model rule; Kiro session model where the harness records it).

## Limits

- **n=1 per task is descriptive.** With one repetition the table prints the numbers and says `descriptive only: n=1 per task`.
  No interval is shown, and a difference of a few points between cells is within what one rerun can change.
- **Intervals need replicates.** `report-2x2` prints a paired-by-task t interval only when at least 5 tasks have at least 2
  scored replicates in every cell. The full study would use 5 repetitions and report those intervals.
- **Five tasks are a small and hand-picked sample.** They are the tasks of the earlier studies, chosen for continuity, not
  drawn from a population.
- **Judges are models.** The panel agrees with people to the extent the calibration section of the README shows; the pilot does
  not repeat that check.
- **A timeout is a cost and a quality event at once.** Kiro meters no credits for a run it kills, so a cell with timeouts has a
  cost lower bound, and the ratio says so.
- **Claude Code vanilla is not empty.** Built-in agents and skills exist in that arm too (see the harness section of the README).

## How the pieces fit

- `bench/report/factorial.js` and `bench.js report-2x2` load four judged run directories with the existing loaders
  (`loadRuns`, `analyze`), score them with the existing formula and lay them side by side. They only read.
- `bench/scripts/pilot-2x2.sh` runs the cells, judges them and calls `report-2x2`. It makes one `bench.js run` per cell and
  task, so a rerun skips finished tasks. Its helper `pilot-2x2.js` holds the resume marker, the finished-directory check and the
  spend arithmetic.
- Run directories are one harness each (the loader refuses mixed harnesses), which is why each cell is its own set of
  directories and why judging is per directory.
