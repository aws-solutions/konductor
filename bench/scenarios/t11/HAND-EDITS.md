# T11 hand edits

Owner rule (2026-11-19): every change by anyone other than the recorded author to a task's prompt, fixture, key, checks
or rubric is logged here, and the task carries `handEdited`. Each edited task is re-checked by a non-Claude reviewer
(`review.recheck`).

| task | who | what changed | why |
| --- | --- | --- | --- |
| t11-media-returns-whiteboard | claude (kirocrew-mate-worker, T11 worker session) | `authoring/t11-media-returns-whiteboard/gen/returns-whiteboard.html` (one CSS rule: arrows with no colour class get the blue ink colour) and the PNG rendered from it, `fixtures/t11-media-returns-whiteboard/docs/design/returns-whiteboard.png` | After the author's fix round the scan, openCase and archive arrows had no stroke colour, so only their arrowheads showed and the archive source was unreadable. No label, value, state or test changed. |
| t11-resume-csv-export | claude (kirocrew-mate-worker, T11 worker session) | checks only: `file_exists test/csv-export.test.js` became a count of test cases under `test/` (at least 3 more than the fixture's 6); the `min_matches` on that file and the `contains toISOString` on `src/export.js` were removed; the `fixture_unchanged README.md` check became `format` | The request names no test file, and a correct UTC export need not call `toISOString` or live in `src/export.js`, so these checks failed correct answers. The format change keeps the stub at 20 or less. Prompt, fixture, hidden tests and answers unchanged. |
| t11-merge-pricing-branches | claude (kirocrew-mate-worker, T11 worker session) | checks only: at least 1 merge commit instead of 2; `file_exists test/feature-pricing.test.js` became a count of test cases under `test/` (at least 3 more than the fixture's 8) | The request does not ask for two separate merges (one octopus merge is correct too) and names no test file. Prompt, fixture, hidden tests and answers unchanged. |
| t11-media-returns-whiteboard | claude (kirocrew-mate-worker, T11 worker session) | checks only: `file_exists test/returns-lifecycle.test.js` became a count of test cases under `test/` (at least 6: the fixture has 5, one of them in the old lifecycle test that the new flow replaces) | The request names no test file. Prompt, fixture, hidden tests and answers unchanged. |
## Dropped

| task | why |
| --- | --- |
| t11-wide-settings-migration | Second family, three tries. qwen3-coder-next try 1: step 1 needed its fix round (no runnable visible suite, 22 of 60 caller files, a request that listed the traps), then step 2 stopped at the 150 tool-call cap with no checks written. minimax-m2.5: step 1 ended its turn with no tool call. qwen3-coder-next try 2, smaller scope (one generator, 60 to 64 callers): step 1 passed after its fix round, step 2 again stopped at the cap with no checks. Dropped, not hand-fixed. About 51 credits spent. |
| t11-docx-room-booking-reqs | Second family (qwen3-coder-next, two steps). Step 1 left the answer in the fixture (existing RB-001 to RB-016 files restate the spec's rules), made the superseded value no trap (the table already said 3 hours, with a note saying 4 became 3), and wrote literal HTML tags into the .docx text. Its one fix round repaired only the request. Dropped before step 2, not hand-fixed. About 5.6 credits. |
| t11-two-session-memory (planned, not written) | Needs a second, fresh session in the same workspace and HOME. The runner's multi-turn mode only resumes the same conversation after the agent asks a question (bench/runner/lib/run-one.js runTurns), so it cannot test what a new session remembers. Waits for runner support. |
