# T2 hand edits

Every change to a T2 task's prompt, fixture, key, checks or rubric made by anyone other than its recorded author.
Each task listed here carries `handEdited` and gets a non-Claude checklist re-review (`review.recheck`) before lock.
Changes the author made itself after lead notes are not hand edits; they are listed in `authoring/<id>/` (the
reviewer's verdicts before and after the fix round).

| Date | Task | Who | What changed | Why |
| --- | --- | --- | --- | --- |
| 2026-11-19 | t2-pr-refund-flow | claude (T2 batch worker session) | `hidden/.../key.json`: items k2 and k3 get `slack: 0` (their spans are two lines apart) | with the default 3-line slack one finding could match either item |
| 2026-11-19 | t2-dr-notify-fanout | claude (T2 batch worker session) | fixture `docs/design/notification-fanout.md`: section 5.3 split into 5.3.1 to 5.3.5; three sentences that stated the planted gaps outright ("No dead-letter queue implementation", "No duplicate detection at consumer level", "No idempotency keys or deduplication logic implemented") reworded as the author's confident claims; "Not encrypted (already encrypted in transit)" became "Protected by TLS between services". `key.json` sections of k1 and k2 moved to 5.3.3 and 5.3.2; `solution/REVIEW.md` locations to match. `expertKey`: items e2 and e5 removed | the fixture listed two answers word for word; two planted items shared 5.3; the two expert items repeated planted findings |
| 2026-11-19 | t2-gaps-jwt-middleware | claude (T2 batch worker session) | `key.json`: decoy d2 (`src/app.js:19-20`) removed | the teammate's existing review comments on `src/app.js:18`, so the decoy sat on a line already discussed |
| 2026-11-19 | t2-arch-dr-event-store | claude (T2 batch worker session) | `expertKey` item e2: source changed from RFC 9700 to the SRE book | the item is about relay ordering, which RFC 9700 (OAuth security) does not cover |
| 2026-11-19 | t2-pr-cursor-pages | claude (T2 batch worker session) | `key.json`: the five items in `src/api/issues.js` get `slack: 1` | they sit on lines 10 to 23, so a 3-line slack let one finding match a neighbour |
| 2026-11-19 | t2-pr-orders-migration | claude (T2 batch worker session) | fixture: `tests/__pycache__/` removed (build now drops `__pycache__`, `.pyc` and `.pytest_cache`) | the byte-code held host paths from the author's run |
| 2026-11-19 | t2-arch-dr-two-regions | claude (T2 batch worker session) | fixture `data/dns-config.json`: an SNS topic ARN holding a 12-digit example account id became `"alert_topic": "dns-health-alerts"` | the public-repo scan refuses anything shaped like a cloud account id |
| 2026-11-20 | every review task | claude (T2 batch worker session) | `lib/findings.test.cjs` and `lib/findings-key.cjs` copied into each hidden dir: every key item is `fixRequired` (a finding counts only when its fix or issue holds a fix keyword). Tasks: t2-arch-dr-event-store, t2-arch-dr-split-checkout, t2-arch-dr-two-regions, t2-dr-data-erasure, t2-dr-notify-fanout, t2-dr-rate-limits, t2-dr-search-reindex, t2-gaps-jwt-middleware, t2-pr-avatar-upload, t2-pr-cursor-pages, t2-pr-orders-migration, t2-pr-price-cache, t2-pr-refund-flow, t2-sec-pr-webhook-relay, t2-pr-stock-reserve, t2-sec-dr-sso-login; the first 14 were landed and move to version 2 | a shallow fake review (a generic remark at each changed file or section) scored above 40 on four tasks; it now scores 28.6 to 35.1 on all 16, and the reference written in another style still scores 100 |
| 2026-11-20 | t2-pr-refund-flow | claude (T2 batch worker session) | `key.json` item k4: span 24-30 widened to 24-39 (through the ledger write and the order save) with `slack: 1`; version 3 | the glm-5 re-check found that the race spans the balance check and the writes, so a finding at the write lines did not match |

Changes that touch every task the same way, recorded once:

| Date | What | Why |
| --- | --- | --- |
| 2026-11-19 | `build-task.js` rewrites every `expertKey` item's source to "name, URL (licence)" from a fixed list of six checked sources | the owner asked for each source by name and URL |
| 2026-11-19 | `bench/runner/lib/findings-key.js` (and every T2 copy): of the findings at a location, the grader takes the one whose severity and fix fit the key item best | listing two nearby findings in another order swapped them and cost a correct review up to 24 points |
| 2026-11-20 | T2 moves onto the shared scenario tools: hidden dirs name `findings.test.cjs` and `findings-key.cjs` in `.bench-lib.json` (byte-identical to the deleted copies); `dry-run.js` and `render-prompt.js` deleted; the T2 lazy, alternative and dump answers move into `scenario.config.js`; `pilot.dryRun` re-recorded on all 16 tasks with the same scores | owner rule: one shared tool set, no per-batch copies |

## Rubric fixes after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task reviews of 2026-11-19 and 2026-11-20 (empty rubrics, single-item 0/15/30 dials, generic polish items). Each item now carries Fail, Partial and Pass anchors in its criterion text, because the rubric schema has no anchor field and the judge reads the criterion as written. Rubric changes do not move the code-only dry-run scores, so pilot.dryRun stands. Each task's version is bumped and handEdited names this session; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t2-arch-dr-event-store`: r1 given Fail/Partial/Pass anchors.
- `t2-arch-dr-split-checkout`: r1 given Fail/Partial/Pass anchors.
- `t2-arch-dr-two-regions`: r1 given Fail/Partial/Pass anchors.
- `t2-dr-data-erasure`: r1 given Fail/Partial/Pass anchors.
- `t2-dr-notify-fanout`: r1 given Fail/Partial/Pass anchors.
- `t2-dr-rate-limits`: r1 given Fail/Partial/Pass anchors.
- `t2-dr-search-reindex`: r1 given Fail/Partial/Pass anchors.
- `t2-gaps-jwt-middleware`: r1 given Fail/Partial/Pass anchors.
- `t2-pr-avatar-upload`: r1 given Fail/Partial/Pass anchors.
- `t2-pr-cursor-pages`: r1 given Fail/Partial/Pass anchors.
- `t2-pr-orders-migration`: r1 given Fail/Partial/Pass anchors.
- `t2-pr-price-cache`: r1 given Fail/Partial/Pass anchors.
- `t2-pr-refund-flow`: r1 given Fail/Partial/Pass anchors.
- `t2-pr-stock-reserve`: r1 given Fail/Partial/Pass anchors.
- `t2-sec-dr-sso-login`: r1 given Fail/Partial/Pass anchors.
- `t2-sec-pr-webhook-relay`: r1 given Fail/Partial/Pass anchors.
