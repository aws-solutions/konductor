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
  mismatch, a konductor cell with no recorded commit, and a cell built from more than one commit.
- **Tasks.** Five lite tasks: `simple-fix-failing-test`, `simple-explain-file`, `orch-input-validation`,
  `review-inventory-security`, `design-hold-service`. `design-hold-service` hit the 600 s limit in many earlier Kiro konductor
  runs. It stays in; a timeout is scored on what the run produced, marked in the table, and shown again with timeouts
  excluded.
- **Judging.** One panel for all four cells (`gpt-5.6-luna`, `deepseek-3.2`, `glm-5` through opencode on Bedrock), rubric mode
  only, no cross-cell pairwise comparison. Each cell is judged on its own against the task rubric, so the scores are absolute
  and comparable across cells. The combiner refuses cells judged by different panels, backends, Bedrock model ids or rubric
  revisions, and any run scored by only part of the panel.

## Units

Quality is a 0 to 100 score, the repository formula (hidden tests 0.5, checks 0.2, rubric 0.3, renormalised over the parts a run
has). It is compared across all four cells. By default the checks part is 1 only when every check passed. With no hidden
tests, one failed check then costs 40 points. `--scoring bench/profiles/scoring-fractional.json` scores the checks part as
passed / total instead, with the same weights; the report names the mode on its weights line.

The rubric part of quality depends on the evidence-quote rule. The default is lenient (tightened: a quote with 20 or more
unsupported letters is rejected); `--scoring bench/profiles/scoring-strict-quotes.json` selects strict, which reproduces the numbers
of pilot tables made before lenient became the default. The 2x2 page names the rule on its first lines and shows the quality of
each cell under both rules, with the rank under each and a warning when the order of the cells differs. A pilot table made
before this change is strict and is not directly comparable with a new one. See the evidence-quote rule in `README.md`.

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

## Charts

With `--out`, `report-2x2` also writes three SVG charts to `charts/` and links them from `factorial-2x2.md`, in the style of the
`report` charts:

| File | Shows | Unit |
| --- | --- | --- |
| `quality-by-cell.svg` | the four cells as bars (mean over tasks) with one dot per task | quality, 0 to 100, one axis for all four |
| `konductor-effect.svg` | konductor minus vanilla, one bar per harness | quality points |
| `cost-ratio.svg` | konductor cost over vanilla cost per run, one bar per harness | a ratio; the label names the unit, credits for Kiro and USD for Claude Code |

Credits and USD never share an axis: cost is drawn only as the ratio inside a harness. While the table is descriptive, every chart
carries the subtitle `descriptive only: n=1 per task` (or the other reason the table gives) and no whiskers. Whiskers on the effect
chart appear only when the table has intervals. The quality chart has no interval at any size, since the table gives none for a cell mean.

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
- **Check wording can decide a cell.** Under the default scoring the checks term is 1 only when every check passes, so one brittle check moves a run by 40 points. On `design-hold-service`, four checks measured wording and failed designs that had the content; three of the four pilot cells lost the 40 points. They were rewritten (see "Revised checks of `design-hold-service`" in `README-tasks.md`), and pilot results scored before that read as stale for this task. `bench.js recheck --run CELL_DIR` rescores a saved cell; `report-2x2` then needs no change.
- **Why a cell scored what it did.** `bench.js explain --run DIR --arm CELL --task T` prints the checks, the rubric per judge and the arithmetic for one cell and task, and `bench.js trace --run DIR --arm CELL --task T --rep 1` prints what the run did, in order. A `cells/` root works as `--run`; `--arm` names the cell (`kiro-vanilla`, `kiro-konductor`, `cc-vanilla`, `cc-konductor`).
- **Kiro sessions.** Cells run on engine v3 save `session/sess_<id>/` files; cells saved before that fix have none and read `transcriptPartial`.

## How the pieces fit

- `bench/report/factorial.js` and `bench.js report-2x2` load four judged run directories with the existing loaders
  (`loadRuns`, `analyze`), score them with the existing formula and lay them side by side. They only read.
- `bench/scripts/pilot-2x2.sh` runs the cells, judges them and calls `report-2x2`. It makes one `bench.js run` per cell and
  task, so a rerun skips finished tasks. Its helper `pilot-2x2.js` holds the resume marker, the finished-directory check and the
  spend arithmetic.
- Order: within each harness the konductor cell runs before the vanilla cell, so a refused install (for example an agent
  without the dashed model pin) stops the harness before the vanilla cell spends anything. If every konductor run of a harness
  stops before recording a result, the vanilla cell of that harness is not started.
- Budget: Claude Code runs stop starting at 90% of `--budget-usd`. Each run gets `min(--run-budget-usd, allowance left)` as its
  cap, and none starts with less than USD 0.05 left. claude checks its cap between turns, so the run that crosses the allowance
  can pass it by up to one turn; the 10% held for judging absorbs that. A run killed before it recorded a cost is counted at
  the cap it was given, and the script says so.
- Run directories are one harness each (the loader refuses mixed harnesses), which is why each cell is its own set of
  directories and why judging is per directory.
