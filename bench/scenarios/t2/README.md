# T2: review tasks

Scenario batch T2 of the v3 pack: code and PR review, design review and security review, each with problems planted
in a realistic pull request or design packet, plus near-miss twins on the same fixtures. Load the tasks with
`--extra-tasks bench/scenarios/t2`.

## Layout

| Path | What |
| --- | --- |
| `<id>.json` | the task (schema v3) |
| `fixtures/<id>/` | the project the agent gets: a repo at the head of a PR with `pr/<n>/description.md` and `pr/<n>/changes.diff`, or a design packet under `docs/` |
| `hidden/<id>/hidden/` | the hidden test, its key and a copy of the grader |
| `solutions/<id>/` | the reference answer (`REVIEW.md`, or the twin's summary) |
| `briefs/<id>.json` | the brief the author model got: phase, role, kind, size, public source and licence |
| `prompts/` | author, twin author, mapping and review prompts |
| `lib/` | the hidden test files and the standard checks |
| `AUTHORING-LOG.md` | every model call: task, step, model, seconds, credits |

## How a review task is scored

The agent writes `REVIEW.md` ending with a fenced json list of findings (`location`, `severity`, `issue`, `fix`); the
prompt asks for that shape and nothing else about layout. The hidden test `lib/findings.test.cjs` grades the list
against `key.json` with the bench findings-key grader (`lib/findings-key.cjs`, a byte-identical copy, renamed so it loads in an ES module project, of
`bench/runner/lib/findings-key.js`): a finding matches a key item when its location names the item's file within 3
lines of its span (or its section number, for a design document), and earns credit for the right severity and fix
words; a list longer than 1.5 times the key is scaled down. The grade becomes 20 slice tests (the pass share is the
grade rounded to 5%), plus one test per decoy, correct code that looks wrong, that fails when a finding names it.
`hidden/` is self-contained because hidden tests run in a copy of the workspace; `test/hidden-copies.test.js` keeps
every copy identical to `lib/`. The copies go when the runner gets a `findings` check type (`bench/DEBT.md` D-43).

The other checks (`lib/checks.js`): `REVIEW.md` exists, the findings block has the asked shape (format, not scored),
every `file:line` or section number points at a real place, and the code or document under review is unchanged.

A twin is scored by `lib/twin.test.cjs` on `twin-key.json`: one test per fact the summary must state, and one per false
claim it must not make.

## Making a task

`node render-prompt.js <id>` prints the author prompt for a brief. The author model writes `fixture/`, `key.json`,
`solution/` and `task-draft.json` in an empty dir; `node build-task.js <id> <dir>` turns them into the files above,
merging the mapper's `map.json` and the reviewer's `review.json` when present. `node dry-run.js <id>` scores the
reference, an empty stub and a dump that flags every changed line, three times each, with the runner's check code.
Gates: reference at least 95, stub at most 20, dump at most 55, all checks pass the reference, identical repeats.

Tests: `node --test bench/scenarios/t2/test/*.test.js`.
