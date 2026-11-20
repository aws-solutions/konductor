# T7: TPM planning, status and estimation tasks

Scenario batch T7 of the v3 pack: status from a ticket export, date and dependency checks, sprint and release
forecasts, risk registers, scope cuts, a program roll-up, a release go/no-go and a program framing, plus one PM, one
developer planning task and one near-miss twin. Each task gives the agent a folder of invented inputs (ticket exports in
CSV or JSON, a roadmap, capacity, holidays) with traps planted in the data: a buried dependency on the longest chain, a
date conflict, an over-allocated person, work added after scope lock, and a decoy that looks risky and is not. Load
the tasks with `--extra-tasks bench/scenarios/t7`.

## Layout

| Path | What |
| --- | --- |
| `<id>.json` | the task (schema v3) |
| `fixtures/<id>/` | the folder the agent gets; the twin `t7-status-slip-twin` uses `fixtures/t7-status-slip/` |
| `hidden/<id>/hidden/` | `key.json`; `hidden/<id>/.bench-lib.json` names the graders `plan-grade.cjs` and `plan.test.cjs` from `bench/scenarios/lib/hidden` |
| `solutions/<id>/` | the reference answer, an overlay on the fixture |
| `authoring/<id>/` | the author's `generate.py` (fixed seed) and `compute_key.py`, which derives the key from the fixture alone |
| `briefs/<id>.json` | the brief the author model got: phase, role, inputs, traps, output shape, public source and licence |
| `prompts/` | the author and review prompts (mapping uses the shared `bench/scenarios/lib/prompts/map.md`) |
| `scenario.config.js` | this batch's config for the shared tools in `bench/scenarios/lib`: the prompt, the task builder and its checks, the pipeline steps prompt, author and fix, and the decoys of the mechanical lazy answer |
| `answers/<id>/` | the lazy, alternative and padding answers the dry run scores |
| `AUTHORING-LOG.md` | every model call: task, step, model, seconds, credits |

## How a task is scored

The agent writes one document (the prompt names its path) holding a fenced JSON block with a named info string and a
shape the prompt states. `hidden/plan.test.cjs` reads that block with `plan-grade.cjs` and runs one test per assertion
in `key.json`: a risk cites the seeded ticket, the critical path holds and orders the right tickets, a date lies within
a few days of the key, a number within its tolerance, a decoy is not named, and a precision assertion that fails a list
padded past about 1.5 times the seeded items. The pass share is the hidden-test score. The other checks: the document
exists, the main input file is unchanged, and the block is present (format, not scored). Rubric items (at most 30%) and,
on tasks with trade-offs, an `expertKey` cover what code cannot check.

## Making a task

All through the shared tools with `--config bench/scenarios/t7/scenario.config.js` (`bench/scenarios/lib/README.md`).
`T7_AUTH=DIR node bench/scenarios/lib/stage.js --config ... prompt|author|fix|map|review|assemble <id>`, where DIR holds
`run.sh` (Kiro CLI in a scratch home with no steering, rules, MCP or skills) and `catalog.json` (unit names and
descriptions only, from `../t1/catalog-descriptions.js`). `node bench/scenarios/lib/dry-run.js --config ... [id]` scores
the reference and the untouched fixture three times with the runner's check code and checks that a hung test fails
alone. Gates: reference at least 95, stub at most 20, identical repeats.

The checks: the hidden test; an evidence check (weight 4, `evidenceCheck` in `scenario.config.js`) that passes when the answer's
block names at least 80% of the items the key requires in its all-items `includes`, `cites` and `order` assertions;
the output exists and the main input is unchanged (weight 1 each); the block is present (format, not scored).
`node bench/scenarios/lib/answers.js --config ... lazy|alt <id>` writes the mechanical shallow answer (`answers/<id>/lazy/`,
with the key's decoys) or alternative (other order, ids, wording). The dry run scores `answers/<id>/lazy/` (gate: 40 or
less) and `answers/<id>/alt/` (gate: 80 or more); `--record` writes the four scores into the task's `pilot.dryRun`.
`node pad-answer.js <id>` writes `answers/<id>/pad/`, a padding probe that is reported, not gated.

Tests: `node --test bench/scenarios/t7/test/*.test.js`.
