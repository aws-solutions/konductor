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
| t11-wide-settings-refactor | claude (kirocrew-mate-worker, CV-C session) | rubric only: the `migration-clarity` item got Fail, Partial and Pass anchors (the criterion's first sentence is the author's) | The batch rule needs anchors on every rubric item, and the author's one fix round was already spent. Prompt, fixture, hidden tests, checks and answers unchanged. |
| t11-merge-pricing-branches v3 | claude (mate wave 11/12 fix worker, 2026-11-21) | key: Meadow rate 0.03 became 0 in the hidden tests, the reference and the alternative answer (`default.json`, `docs/pricing.md`, the reference's rounding test); the unknown-promo hidden test now accepts a rejection or no discount; three hidden tests got a discriminating assertion (BASKET5 below minimum is quoted in Ridge, the Meadow test also rejects an unknown region, the unknown-promo test also checks WELCOME10 applies) | Wave 11: the fixture's `feature/tax-regions` branch says "Meadow is a zero-rate region" and sets rate 0, and nothing in the request or fixture gives 0.03, so a faithful merge failed five hidden tests. The promo branch ignores an unknown code and the request is silent, so the old `/unknown promo code/` throw was not derivable. The added assertions keep the stub at 10.2 after rate 0 made three Meadow tests pass on untouched main. Prompt, fixture and checks unchanged. |

## Dropped

| task | why |
| --- | --- |
| t11-wide-settings-migration | Second family, three tries. qwen3-coder-next try 1: step 1 needed its fix round (no runnable visible suite, 22 of 60 caller files, a request that listed the traps), then step 2 stopped at the 150 tool-call cap with no checks written. minimax-m2.5: step 1 ended its turn with no tool call. qwen3-coder-next try 2, smaller scope (one generator, 60 to 64 callers): step 1 passed after its fix round, step 2 again stopped at the cap with no checks. Dropped, not hand-fixed. About 51 credits spent. |
| t11-docx-room-booking-reqs | Second family (qwen3-coder-next, two steps). Step 1 left the answer in the fixture (existing RB-001 to RB-016 files restate the spec's rules), made the superseded value no trap (the table already said 3 hours, with a note saying 4 became 3), and wrote literal HTML tags into the .docx text. Its one fix round repaired only the request. Dropped before step 2, not hand-fixed. About 5.6 credits. The id was then written again from the same brief by gpt-5.6-luna in one call (the id had not landed). |
| t11-two-session-memory (planned, not written) | Needed a second, fresh session in the same workspace and HOME, which the runner did not have. The runner gained `freshSessions` on 2026-11-20 (5a443a10) and the task was written as `t11-fresh-session-memory`. |

## Rubric anchors, review fix 2 (2026-11-20, mate review-fix2 worker)

Who: claude (mate review-fix2 worker session). The three unanchored items now carry Fail, Partial and Pass anchors, and `t11-twin-pricing-validation` (empty rubric, a twin that other batches judge too) gets two anchored items, rule-coverage and error-message, weight 1 each. Rubric text does not move code-only dry-run scores, so pilot.dryRun stands. Versions bumped; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t11-media-returns-whiteboard`: image-legibility.
- `t11-merge-pricing-branches`: release-record.
- `t11-resume-csv-export`: focused-change.
- `t11-twin-pricing-validation`: rule-coverage and error-message added.

## Non-Claude recheck (D-108, 2026-11-20, mate hand-edit recheck worker)

Every Claude hand edit above was checked again. Free first: the free gates (reference, empty, lazy, alternative) and
two scans (rubric anchors and hidden-test names found only in the reference, not in the request or fixture). Then a
non-Claude model ran the four-item checklist ("full": request, fixture, hidden key and rubric; "rubric": the rubric
edits, on top of the earlier non-Claude check of the request, fixture and key). Verdicts are in each task's
`review.recheck`; calls and credits in reports/hand-edit-recheck-2026-11-20.md.

| Task | Recheck | Result | Note |
| --- | --- | --- | --- |
| t11-media-returns-whiteboard | qwen3-coder-next (earlier, after the last edit) | confirmed |  |
| t11-merge-pricing-branches | qwen3-coder-next (earlier, after the last edit) | confirmed | qwen3-coder-next (after the last edit) failed solvable-from-fixture on a missing test/feature-pricing.test.js; that file comes from the feature branch the task merges, so the T11 worker disposed it as a misread and this job agrees |
| t11-resume-csv-export | qwen3-coder-next (earlier, after the last edit) | confirmed | qwen3-coder-next failed two items because the fixture lacks the CSV behaviour; that behaviour is the work the request asks for, so the T11 worker disposed it as a misread and this job agrees |
| t11-twin-pricing-validation | qwen3-coder-next (earlier, after the last edit) | confirmed |  |

## t11-docx-room-booking-reqs v2 (2026-11-21, mate debt worker, DEBT D-136)

`old-duration-absent` failed a correct requirement that names the old limit ("no longer than 3 hours (the old limit
was 4 hours)"). Its `match` now has a `none` pattern, anchored with `^.*` so it reads the text as written: a requirement
that says 4 hours was, or is replaced by, the old value is not counted. A plain "no longer than 4 hours" still fails.
`answers/t11-docx-room-booking-reqs/other/` is that correct answer; `scenario.config.js` now scores `other` answers.

| Answer | Before | After |
| --- | --- | --- |
| reference | 100 | 100 |
| stub | 4.8 | 4.8 |
| lazy | 39.5 | 39.5 |
| alt | 100 | 100 |
| other (names the old 4 hours) | 95.9 | 100 |

Non-Claude recheck: pending (paid; `handEdited.version` 2 blocks a lock until a recheck records it).

## t11-media-returns-whiteboard v3 (2026-11-21, mate debt worker, DEBT D-119)

The fixture's `npm test`, CI line and README ran `node --test test/`, which fails on Node 22 and later (Node reads the
directory as one file), so an untouched fixture looked broken. All three now run `node --test test/*.test.js`. Free
gates unchanged: reference 100, stub 17.5, lazy 23.8, alt 100. Non-Claude recheck: pending (`handEdited.version` 3).

## Rubric anchors (2026-11-21, mate debt worker, DEBT D-117)

`t11-docx-room-booking-reqs` v3 (`narrative-judgment`) and `t11-guide-contributing` v2 (`review-guidance`) each had a
judged rubric item with no Fail / Partial / Pass anchor; each now has the three. No check, key, fixture or answer
changed. Non-Claude recheck: pending (`handEdited.version` 3 and 2).

## Review fixes of the wave 11/12 edits (2026-11-21, mate wave 11/12 review-fix worker, claude)

From `reports/review-wave11-12-edits-claude-opus-5.5.md` and `reports/review-wave11-12-edits-claude-fable-5.1.md`.
No model call. Probe answers scored with the bench's own check code.

| Task | What changed | Why |
| --- | --- | --- |
| t11-docx-room-booking-reqs v4 | key: `old-duration-absent` also allows "revised from" and "changed from" before the old 4 hours | The docx itself says "revised from 4 hours to 3 hours"; a correct requirement quoting it scored 95.9, the same one with "reduced from" 100 (Opus F4). Now both 100. |
| t11-docx-room-booking-reqs v4 | key: new gate item `revision-notes-applied` (some requirement states 30 days or 3 hours; when none does, every hidden test fails); checks: `file_exists`, `min_matches`, `contains` and `fixture_unchanged` are `format` (were `substance`); new `answers/.../shallow`: the Booking limits table copied as written, no revision, no open question; ceiling note rewritten | A realistic lazy answer scored 79.6 (Opus F8): the traps were 10 of 35 weights, and any requirements file earned about 30 points from shape checks (Fable). Now that answer scores 0, one revision applied 86.1, no open question 91.7, reference, alt and other 100. Stub 4.8 -> 0. |
| t11-merge-pricing-branches v4 | hidden test: "has no conflict markers in tracked files" no longer asserts that `test/feature-pricing.test.js` exists; check 4 counts test cases in committed files (`git grep ... HEAD -- test`) and needs 14, not 11; two hidden tests renamed ("applies WELCOME10 to a Meadow basket, which owes no tax", "applies BASKET5 at its minimum basket in Meadow") | The request names no test file, and the wave 11 answer lost a hidden test for naming its tests `test/combined.test.js` (Fable F5). Main has 8 test cases and the two branches add 2 each, so the merge alone reached 12 and passed "add focused tests" (Fable F6). With Meadow at rate 0 the two old names no longer described what they test (Opus F9). Probes: tests under another name 100, merge with no new test 88.6 (fails check 4), `-X theirs` / `-X ours` 29.3, the wrong answers of the review unchanged. |

## t11-media-returns-whiteboard v4 (2026-11-21, mate debt worker, DEBT D-153)

The one judge item, `image-legibility`, asked whether the whiteboard image is readable. The judges read text only, so
the item was never really scored, and it rated the input picture, not the agent's work. It is dropped: the task is now
scored by code only (hidden tests and checks), which the 70/30 rule allows. No check, key or fixture changed.
Non-Claude recheck: pending (`handEdited.version` 4).
