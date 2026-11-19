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
| `hidden/<id>/hidden/` | `key.json` and copies of `lib/plan-grade.cjs` and `lib/plan.test.cjs` |
| `solutions/<id>/` | the reference answer, an overlay on the fixture |
| `authoring/<id>/` | the author's `generate.py` (fixed seed) and `compute_key.py`, which derives the key from the fixture alone |
| `briefs/<id>.json` | the brief the author model got: phase, role, inputs, traps, output shape, public source and licence |
| `prompts/` | the author and review prompts (mapping uses `../t1/prompts/map.md`) |
| `stage.js` | the pipeline steps: prompt, author, fix, map, review, assemble |
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

`T7_AUTH=DIR node stage.js prompt|author|map|review|assemble <id>`, where DIR holds `run.sh` (Kiro CLI in a scratch home
with no steering, rules, MCP or skills) and `catalog.json` (unit names and descriptions only, from
`../t1/catalog-descriptions.js`). `node ../t1/dry-run.js <id> --dir bench/scenarios/t7` scores the reference and the
untouched fixture three times with the runner's check code, and checks that a hung test fails alone. Gates: reference at
least 95, stub at most 20, identical repeats.

Tests: `node --test bench/scenarios/t7/test/*.test.js`.
