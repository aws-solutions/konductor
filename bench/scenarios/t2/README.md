# T2: review tasks

Scenario batch T2 of the v3 pack: code and PR review, design review and security review, each with problems planted
in a realistic pull request or design packet. Load the tasks with `--extra-tasks bench/scenarios/t2`.

## Layout

| Path | What |
| --- | --- |
| `<id>.json` | the task (schema v3) |
| `fixtures/<id>/` | the project the agent gets: a repo at the head of a PR with `pr/<n>/description.md` and `pr/<n>/changes.diff`, or a design packet under `docs/` |
| `hidden/<id>/` | `hidden/key.json` and `.bench-lib.json`, which names the grader in `bench/scenarios/lib/hidden` |
| `solutions/<id>/` | the reference answer (`REVIEW.md`) |
| `briefs/<id>.json` | the brief the author model got: phase, role, kind, size, author and reviewer, public source and licence |
| `prompts/` | author (one call, or the two calls of the two-step method), expert key, mapping, review and re-check prompts |
| `scenario.config.js` | this batch's config for the shared tools: the author prompt and the dry run's answers |
| `build-task.js`, `lib/checks.js` | turn an author's work dir into the files above; the standard checks |
| `authoring/<id>/` | the mapper's and reviewers' answers and the author's notes; `authoring/DROPPED.md` lists dropped tasks |
| `AUTHORING-LOG.md` | every model call: task, step, model, seconds, credits, with totals per wave |
| `HAND-EDITS.md` | every change made by someone other than a task's author |

## How a review task is scored

The agent writes `REVIEW.md` ending with a fenced json list of findings (`location`, `severity`, `issue`, `fix`); the
prompt asks for that shape and nothing else about layout. The hidden test `findings.test.cjs` (copied in at run time
from `bench/scenarios/lib/hidden`) grades the list against `key.json` with the bench findings-key grader: a finding
matches a key item when its location names the item's file within 3 lines of its span (or its section number, for a
design document) and its fix or issue holds one of the item's fix words; it earns more for the right severity and
fix. A list longer than 1.5 times the key is scaled down. The grade becomes 20 slice tests (the pass share is the grade
rounded to 5%), plus one test per decoy (correct code that looks wrong), which fails when a finding names it.

The other checks (`lib/checks.js`): `REVIEW.md` exists, the findings block has the asked shape (format, not scored),
every `file:line` or section number points at a real place, and the code or document under review is unchanged.

A design review also carries `expertKey`: the risks and trade-offs a strong review raises beyond the planted items,
each with its public source, for the judges only.

## Dry run

```
TMPDIR=/tmp node bench/scenarios/lib/dry-run.js --config bench/scenarios/t2/scenario.config.js [id ...] [--record]
```

It scores the reference, the stub, a lazy answer (one generic remark at each changed file or section), an
alternative answer (the reference findings reordered, with line ranges or section labels, in a `{"findings"}`
wrapper) and a dump (every changed line or subsection flagged). Gates: reference 95 or more, stub 20 or less, lazy 40
or less, alternative 90 or more, dump 55 or less, identical repeats. `--record` writes `pilot.dryRun`, which
`bench.js scenarios ready --batch t2` reads.

## Making a task

`node bench/scenarios/lib/prompt.js --config bench/scenarios/t2/scenario.config.js <id>` prints the author prompt.
First-family authors (gpt-5.6-luna, deepseek-3.2) write the task in one call. Other authors use two calls: the first
writes `fixture/`, `task-draft.json` and `PLANTED.md`; a second, separate call reads them and writes `key.json`, the
reference and the expert key (`scenario.config.js` `render(id, lib, 'fixture' | 'key')`). `node build-task.js <id>
<dir>` turns the work dir into the files above, merging `map.json`, `review.json` and `recheck.json` when present.

Tests: `node --test bench/scenarios/t2/test/*.test.js`.
