You are writing ONE benchmark task for AI coding agents, a near-miss twin of an existing task. The current directory holds `fixture/`, a small realistic Node.js repository (a shop's cart and pricing code with a decent test suite). Hidden tests, which the agent never sees, decide how well it did. Work only inside the current directory. Do not read or write anything outside it. You have no network. Do not change anything in `fixture/`.

## The ask

{{BRIEF}}

## What to produce

1. `hidden/`: hidden tests, laid out relative to the repository root (copied over it before they run): `hidden/*.test.js` using node:test and node:assert, at least 12 tests, each independent, deterministic, under 5 seconds, with no real sleeps and no network. Test only behaviour and interfaces the request states (names, paths, formats, limits). On the untouched fixture at most 20% of them may pass. Some must catch a plausible lazy answer.
2. `solution/`: the reference overlay (every file it adds or changes, at its path, in full). It makes every hidden test pass and keeps every existing fixture test passing.
3. `task-draft.json`, one JSON object with exactly these keys:
   - `id`: `{{ID}}`
   - `prompt`: the request, in the voice of the shop's developer, plain words, 80 to 200 words. Give every name, path and format the hidden tests rely on. Name no method or process for how to work, and do not tell the agent to ask or not to ask questions. Do not mention hidden tests, scoring or benchmarks.
   - `checks`: `{ "type", ..., "weight", "kind": "substance" | "format" }`. Allowed types: `tests` (`cmd` exactly `node --test --test-timeout=15000 hidden/*.test.js`, `min` the number of hidden tests, weight counts for the report only), `cmd` (optional `expectExit`), `file_exists`, `contains` / `not_contains` (`path`, `pattern` as a JavaScript regex), `min_matches`, `fixture_unchanged`. Add 3 to 5 other checks: the visible suite (`node --test`) still passes with the change, no new dependency in package.json (one `cmd`), a stated file exists. At most 25% of the substance weight (non-`tests` checks) may belong to checks that already pass on the untouched fixture. Every check must pass on `fixture` plus `solution`.
   - `rubric`: 0 to 1 item, only for what code cannot check, ending with "(code cannot check this because ...)".
   - `limits`: `{ "softSec": number, "hardSec": number }`, hardSec twice softSec.
   - `notes`: 3 to 5 short sentences for the reviewer.
4. Run your own checks: put `fixture/` plus `solution/` in a scratch folder, run the existing and hidden tests, and run the hidden tests on the plain fixture. Print a short list of what you verified. Keep everything plain and original, free of internal names, host paths or secrets.
