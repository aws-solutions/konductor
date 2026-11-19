You are writing ONE benchmark task for AI agents, a near-miss twin of an existing task. The current directory holds `fixture/`, an ops folder from a real-looking team (logs, metrics, deploy history, docs). The existing task on this folder asks for an incident investigation. Your task uses the SAME folder for a different, plain request where incident-investigation know-how does not help. Hidden tests, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it. You have no network. Do not change anything in `fixture/`.

## The ask

{{BRIEF}}

## What to produce

1. `hidden/hidden-twin.test.js` (copied to the folder root before it runs): 8 to 12 tests with node:test and node:assert, each independent and deterministic. Compute expected values from the fixture files inside the tests or from constants you computed with a script (never by hand). Test only what the request states (paths, column names, formats). At most 20% pass on the untouched fixture.
2. `solution/`: the reference overlay (every file it adds, in full), produced by a script you run, so its numbers are right.
3. `task-draft.json`, one JSON object with exactly these keys:
   - `id`: `{{ID}}`
   - `prompt`: the request, plain words, 60 to 180 words, in the voice of a colleague from another team. Give every path, column name and format the tests rely on. Name no method, and do not tell the agent to ask or not to ask questions. Do not mention hidden tests, scoring or benchmarks, and do not mention any incident.
   - `checks`: `{ "type", ..., "weight", "kind": "substance" | "format" }`: the tests check `{ "type": "tests", "cmd": "node --test --test-timeout=15000 hidden-twin.test.js", "min": <number of tests>, "weight": 3, "kind": "substance" }`, plus 2 or 3 others (the output file exists; the input logs are unchanged via `fixture_unchanged`). At most 25% of the non-tests substance weight may pass on the untouched fixture.
   - `rubric`: [] .
   - `limits`: `{ "softSec": number, "hardSec": number }`, hardSec twice softSec.
   - `notes`: 3 to 5 short sentences for the reviewer.
4. Run `node kit/selfcheck.js` and fix what fails (every test passes on fixture plus solution; at most 20% on the plain fixture). Print a short list of what you verified. Keep everything plain and original.
