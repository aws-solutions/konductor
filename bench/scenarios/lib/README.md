# Shared scenario tools

Every batch of the scenario pack (`bench/scenarios/t*`, `probe`) uses these tools. A batch adds no copy of them: it passes its own `scenario.config.js`, which says where its parts live and holds only what the batch does differently (its prompt wording, its task builder, extra answers to score). `config.js` lists the fields and their defaults. `bench/runner/test/scenarios-no-copies.test.js` fails on a new per-batch copy.

| File | What it does |
| --- | --- |
| `dry-run.js` | The one free dry run. It scores the reference, the stub (the untouched fixture), the lazy and alternative answers and any batch variants with the bench's own check code. The reference and the stub run 3 times to prove the checks are deterministic. It also checks per-test timeouts, that the task file loads, and, when the batch asks, that a hung test fails alone (the canary). Gates: reference 95 or more, stub 20 or less, lazy 40 or less, alternative 80 or more. `--record` writes `pilot.dryRun`, which `scenarios ready` reads. |
| `answers.js` | Mechanical lazy and alternative answers made from the reference, with no model call. The lazy answer keeps the reference's shape and drops half its substance: half of each list, the batch's decoys added, numbers at 0.7x, dates 21 days early, half of each section's paragraphs, half of the code files. The alternative reorders lists and sections, renames the answer's own ids and rewords free text. A reference of code only gets no alternative. |
| `prompt.js` | The author prompt renderer: slot filling and the brief, for the batch's `prompt.render`. |
| `stage.js` | The authoring stage after the author call: `audit`, `log-author`, `map`, `review`, `assemble`, plus the batch's own subcommands. `audit`, `assemble` and `fold-helpers` (which turns committed helper copies into `.bench-lib.json` entries) run with no model. |
| `score.js` | The code-only score of one pass, from `report/scores.js`: hidden tests 0.5, other checks 0.2, renormalised. |
| `workspace.js` | Fixture copy (as the runner copies it) plus an overlay directory or a scripted edit. |
| `hidden/` | Hidden test helpers (the Python bridge and timeouts, the findings grader, the plan grader). A task's hidden dir names the ones it needs in `.bench-lib.json`, and the `tests` check copies them in at run time (`bench/runner/lib/hidden-lib.js`). No task commits a copy. |
| `prompts/map.md` | The mapping prompt every batch's `map` step uses unless its config names another. |

Free commands (run from the repository root, with `TMPDIR` under `/tmp`):

```
node bench/scenarios/lib/dry-run.js --config bench/scenarios/t8/scenario.config.js [id ...] [--record] [--json]
node bench/scenarios/lib/answers.js --config bench/scenarios/t8/scenario.config.js lazy|alt [id ...]
node bench/scenarios/lib/prompt.js --config bench/scenarios/t8/scenario.config.js <id>
node bench/scenarios/lib/stage.js --config bench/scenarios/t8/scenario.config.js assemble <id>
```

`map`, `review` and a batch's answer or fix commands call a model and cost credits: run them only under an approved cap.

Tests: `node --test bench/runner/test/scenarios-lib.test.js`.
