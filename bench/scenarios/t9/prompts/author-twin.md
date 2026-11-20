You are writing ONE benchmark task for AI coding agents, a near-miss twin of an existing task. The current directory holds `fixture/`, a front-end repository. The existing task on this repository asks for a user-interface change. Your task uses the SAME repository for a different, plain request where front-end and browser know-how does not help: a small, clear data or build-script job. Hidden tests, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it. You have no network. Do not change anything in `fixture/`.

## The ask

{{BRIEF}}

## What to produce

1. `hidden/hidden-twin.test.js`: 8 to 12 tests with node:test and node:assert, each independent and deterministic. Compute expected values from the fixture files inside the tests, or from constants you computed with a script (never by hand). Test only what the request states (paths, field names, formats). At most 20% pass on the untouched fixture.
2. `solution/`: the reference overlay (every file it adds or changes, in full), produced by a script you run, so its numbers are right.
3. `alt/` (a second correct answer with a different structure) and `lazy/` (a shallow answer that passes at most 40% of the tests), same shape as `solution/`.
4. `task-draft.json`, one JSON object with exactly these keys:
   - `id`: `{{ID}}`
   - `prompt`: the request, plain words, 60 to 180 words, in the voice of a colleague from another team. Give every path, field and format the tests rely on. Name no method, and do not tell the agent to ask or not to ask questions. Do not mention hidden tests, scoring or benchmarks, and do not mention any user-interface work.
   - `checks`: the tests check `{ "type": "tests", "cmd": "node --test --test-timeout=15000 hidden-twin.test.js", "min": <number of tests>, "weight": 3, "kind": "substance" }`, plus 2 or 3 others (the output file exists; the input files are unchanged via `fixture_unchanged`; the visible suite passes). The code score is (0.5 x share of hidden tests passed + 0.2 x weight share of the other substance checks passed) / 0.7: the plain fixture must score 20 or less, so make the other substance checks fail on it (one `cmd` check that the output file exists and parses, one that the visible suite passes AND the new script is present) and keep any `fixture_unchanged` check at weight 1.
   - `rubric`: [].
   - `limits`: `{ "softSec": number, "hardSec": number }`, hardSec twice softSec.
   - `notes`: 3 to 5 short sentences for the reviewer.
5. Run `node kit/selfcheck.js` and fix what fails (it prints `estimatedScores`: reference 95 or more, `alt/` 80 or more, plain fixture 20 or less, `lazy/` 40 or less). Print a short list of what you verified. Keep everything plain and original.
