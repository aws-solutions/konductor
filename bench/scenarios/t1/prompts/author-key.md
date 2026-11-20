You are writing the scoring key of ONE benchmark task for AI coding agents. The current directory holds `fixture/` (the repository the agent starts in) and `task-draft.json` (the request in `prompt`, plus `limits` and the author's `notes`). Do not change `fixture/` or the `prompt`. Work only inside the current directory. You have no network.

{{STACK}}

Write:
1. `hidden/`: hidden tests, laid out relative to the repository root (copied over it before they run). {{HIDDEN}}
   - At least 12 tests, each independent, deterministic and under 5 seconds; no real clock sleeps, no network; temp dirs removed.
   - Test only behaviour and interfaces the request states. If a test needs a name the request does not give, write `key-notes.md` saying so and test something the request does state instead.
   - At most 20% of the hidden tests may pass on the untouched fixture. Some tests must catch a plausible lazy answer (a skipped edge case, a regression), and no single detail should decide most tests.
2. `solution/`: the reference change as an overlay on `fixture/` (every file it adds or changes, at its path, in full; deletions in `solution/DELETE.txt`). It must pass every hidden test and keep the existing tests passing.
3. `key-draft.json`, one JSON object with:
   - `checks`: a JSON list of check objects. Every check has a `type` (one of `tests`, `cmd`, `file_exists`, `contains`, `not_contains`, `min_matches`, `fixture_unchanged`), a `weight` and a `kind` (`substance` or `format`), plus the fields its type needs: `cmd` (and optional `expectExit`) for `tests` and `cmd`; `path` for `file_exists` and `fixture_unchanged`; `path` and `pattern` (a JavaScript regular expression) for `contains` and `not_contains`; `path`, `pattern` and `min` for `min_matches`. Example: `{ "type": "contains", "path": "CHANGELOG.md", "pattern": "retry", "weight": 1, "kind": "format" }`. Include one `tests` check whose `cmd` is exactly {{TESTCMD}} with `min` set to the number of hidden tests, plus 3 to 6 other checks (`cmd`, `file_exists`, `contains`, `not_contains`, `min_matches`, `fixture_unchanged`) with `weight` 1 to 3 and `kind` `substance` or `format`. A check that already passes on the untouched fixture is `format`. Every check passes on fixture plus solution.
   - `rubric`: 0 to 2 items `{ "id", "criterion", "weight" }` only for what code cannot check, each ending "(code cannot check this because ...)".
4. Verify from a scratch folder: existing tests pass on fixture plus solution, every hidden test and check passes there, and at most 20% of hidden tests pass on the plain fixture. Remove the scratch folder.

Write each file once, verify at most twice, and finish within about 45 tool calls. Keep everything original, with no internal names, host paths or secrets.
