You are writing the SECOND HALF of ONE benchmark task for AI agents that do product and planning work. Another step already wrote the folder the agent starts in (`fixture/`), the request (`task-draft.json`, key `prompt`), a `gen/` folder with the generator of the seeded data, and notes for you (`task-draft.json`, key `notes`). You write the hidden tests, the reference answer and the checks. Work only inside the current directory. Do not read or write anything outside it. You have no network. Do not change anything under `fixture/` and do not change the `prompt`.

Task id: {{id}}. Output path the agent must write: `{{out}}`. Idea of the task: {{idea}}

## Files you have

- `kit/doc-key.js`: a helper for hidden tests. Copy it unchanged to `hidden/doc-key.js`. It exports `readDoc(rel)`, `lastJsonBlock(text)`, `blockOf(rel)` (the parsed last ```json block of a workspace file, or `{}`), `itemTexts(list)`, `requirementTexts(block)`, `numbersIn(text)` and `scriptedSuite(test, assert, opts)`. Read it before you write tests.
- `kit/check-draft.js`: run `node kit/check-draft.js` when you are done; it scores your reference and a do-nothing stub.

## What to produce

1. Compute the key from the seeded data with a script (`gen/` shows how it was made; rerun or reread the CSVs). Never type a rate, percentile or count from memory: the hidden tests compute them from the fixture files at run time, or the numbers come from a script you ran and the tests allow rounding.
2. `hidden/`: copy `kit/doc-key.js` to `hidden/doc-key.js` unchanged, and write 10 to 16 tests in `hidden/*.test.js` (node:test and node:assert/strict), each independent and deterministic, reading the JSON block of the output with `blockOf`. Each seeded insight or trap is one or more tests: the main finding, each key evidence number (allow rounding where a share is computed), the options, the recommendation, the measure with its baseline. Add 2 precision tests (the decoy is not given as support or cause; no more than K items). Accept reasonable wording (regex alternatives) and number formats. Where the brief says the agent writes a script, the tests run it with `child_process.spawnSync` (a per-test timeout of 20 seconds) on the fixture's files and on at least one other input the tests generate themselves with a different known answer, so a script that hard-codes the fixture's numbers fails.
3. `solution/`: the reference output (an overlay on the fixture: the document at `{{out}}` and any script the request asks for). It must pass every hidden test.
4. Add these keys to `task-draft.json` (keep its existing keys and its `prompt` exactly):
   - `checks`: one `tests` check exactly { "type": "tests", "cmd": "node --test --test-timeout=15000 hidden/*.test.js", "min": N, "weight": 1, "kind": "substance" } where N is the number of hidden tests, plus 3 to 6 other checks: `file_exists`, `fixture_unchanged` on the inputs (`path` is a folder or file of the fixture), `cmd` with node or POSIX tools, `contains` / `not_contains` / `min_matches` (`path`, `pattern` as a case-insensitive JavaScript regex). Each has `weight` 1 to 3 and `kind` "substance" or "format" (format = layout or wording only; a check a half-done answer passes is `format`). At most 25% of the substance weight of these other checks may pass on the untouched fixture.
   - `rubric`: 0 to 2 items { "id", "criterion", "weight" } for what code cannot check. Each criterion states a Fail, a Partial and a Pass anchor with the exact things to look for, and ends "(code cannot check this because ...)". Do not reward length or formatting.
5. Run `node kit/check-draft.js`. The reference must score at least 95 and the stub 20 or less. Fix the key files (never the fixture or the prompt) and rerun until it does. Then print a short list of what you verified. Finish within about 50 tool calls.

Keep everything original, free of real company names, host paths, usernames or secrets. Stop when the files are written and verified.
