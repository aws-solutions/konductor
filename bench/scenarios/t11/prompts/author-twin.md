You are writing ONE benchmark task for AI coding agents, a near-miss twin of an existing task. The current directory holds `fixture/`, a project folder that is a git repository (its repository is stored in `fixture/dotgit`; the bench renames it to `.git` when it copies the fixture). The existing task on this folder needs real git branch work. Your task uses the SAME folder for a different, plain request where git branch work does not help: a small, clear code job on the branch that is checked out. Hidden tests, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it, except that `node kit/selfcheck.js` uses tools installed on this machine. You have no network. Do not change anything in `fixture/`.

## The ask

{{BRIEF}}

## What to produce

1. `hidden/hidden-behaviour.test.js`: 8 to 12 tests with node:test and node:assert, each independent and deterministic, of only what the request states (paths, names, formats). At most 20% pass on the untouched fixture.
2. `solution/`: the reference answer (every file it adds or changes, in full).
3. `alt/` (a second correct answer with a different structure) and `lazy/` (a shallow answer that passes at most 40% of the tests), same shape as `solution/`.
4. `task-draft.json`, one JSON object with exactly these keys:
   - `id`: `{{ID}}`
   - `prompt`: the request, plain words, 60 to 180 words, in the voice of a teammate. Give every path, name and format the tests rely on. Name no method, and do not tell the agent to ask or not to ask questions. Do not mention hidden tests, scoring or benchmarks, and do not ask for any merge, rebase or branch work.
   - `checks`: the tests check `{ "type": "tests", "cmd": "node --test --test-timeout=15000 hidden-behaviour.test.js", "min": <number of tests>, "weight": 3, "kind": "substance" }`, plus 2 or 3 others: one `cmd` check that the visible suite passes AND the agent added at least 2 test cases (count `test(` lines in `test/` against the fixture's count), weight 3, and a `fixture_unchanged` check on a file the request says must not change, weight 1. The code score is (0.5 x share of hidden tests passed + 0.2 x weight share of the other substance checks passed) / 0.7: the plain fixture must score 20 or less.
   - `rubric`: [].
   - `limits`: `{ "softSec": number, "hardSec": number }`, hardSec twice softSec.
   - `notes`: 3 to 5 short sentences for the reviewer.
5. Run `node kit/selfcheck.js` and fix what fails (it prints `estimatedScores`: reference 95 or more, `alt/` 80 or more, plain fixture 20 or less, `lazy/` 40 or less). Print a short list of what you verified. Keep everything plain and original.
