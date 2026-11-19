You are writing ONE small benchmark task for AI coding agents, on a repository that already exists. The current directory holds `fixture/`, the repository the agent starts in. Do not change anything under `fixture/`. Work only inside the current directory. You have no network.

## The brief

{{BRIEF}}

## What to produce

1. `hidden/`: hidden tests, laid out relative to the repository root (copied over it before they run). {{HIDDEN}} At least 6 tests, each independent, deterministic and under 5 seconds; tests that make temp directories remove them. Test only what the request states. On the untouched fixture at most 20% may pass.
2. `solution/`: the reference change as an overlay (every file it adds or changes, at its path, in full; deletions listed in `solution/DELETE.txt`). It must pass every hidden test and keep the existing tests passing.
3. `task-draft.json` with exactly these keys:
   - `id`: `{{ID}}`
   - `prompt`: the request in the voice of a teammate who owns the repo, plain words, 40 to 150 words. Give every name, path and format the hidden tests rely on. Do not name any method or process for how to work, and do not tell the agent to ask or not to ask questions.
   - `checks`: a `tests` check whose `cmd` is exactly {{TESTCMD}} with `min` set to the number of hidden tests, plus 2 to 4 other checks (`cmd`, `file_exists`, `contains`, `not_contains`, `min_matches`, `fixture_unchanged`), each with `weight` (1 to 3) and `kind` (`substance` or `format`; a check that already passes on the untouched fixture is `format`). Every check passes on fixture plus solution.
   - `rubric`: `[]`.
   - `limits`: `{ "softSec": 600, "hardSec": 1200 }`.
   - `notes`: 2 to 4 sentences for the reviewer.
4. Verify from a scratch folder: existing tests pass on fixture plus solution, every hidden test passes there, and at most 20% pass on the plain fixture. Remove the scratch folder.

Write each file once, verify at most twice, and finish within about 35 tool calls. Keep everything original, with no internal names, host paths or secrets.
