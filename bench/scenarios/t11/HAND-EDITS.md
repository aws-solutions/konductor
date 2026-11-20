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

## Rubric anchors, review fix 2 (2026-11-20, mate review-fix2 worker)

Who: claude (mate review-fix2 worker session). The three unanchored items now carry Fail, Partial and Pass anchors, and `t11-twin-pricing-validation` (empty rubric, a twin that other batches judge too) gets two anchored items, rule-coverage and error-message, weight 1 each. Rubric text does not move code-only dry-run scores, so pilot.dryRun stands. Versions bumped; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t11-media-returns-whiteboard`: image-legibility.
- `t11-merge-pricing-branches`: release-record.
- `t11-resume-csv-export`: focused-change.
- `t11-twin-pricing-validation`: rule-coverage and error-message added.
