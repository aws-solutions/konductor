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

## Non-Claude recheck (D-108, 2026-11-20, mate hand-edit recheck worker)

Every Claude hand edit above was checked again. Free first: the free gates (reference, empty, lazy, alternative) and
two scans (rubric anchors and hidden-test names found only in the reference, not in the request or fixture). Then a
non-Claude model ran the four-item checklist ("full": request, fixture, hidden key and rubric; "rubric": the rubric
edits, on top of the earlier non-Claude check of the request, fixture and key). Verdicts are in each task's
`review.recheck`; calls and credits in reports/hand-edit-recheck-2026-11-20.md.

| Task | Recheck | Result | Note |
| --- | --- | --- | --- |
| t2-arch-dr-event-store | glm-5 (r1, rubric) | confirmed |  |
| t2-arch-dr-split-checkout | glm-5 (r1, rubric) | confirmed |  |
| t2-arch-dr-two-regions | glm-5 (r1, rubric) | confirmed |  |
| t2-dr-data-erasure | glm-5 (r1, rubric) | confirmed |  |
| t2-dr-notify-fanout | glm-5 (r1, rubric) | confirmed |  |
| t2-dr-rate-limits | glm-5 (r1, rubric) | confirmed |  |
| t2-dr-search-reindex | glm-5 (r1, rubric) | confirmed |  |
| t2-gaps-jwt-middleware | glm-5 (r1, rubric) | confirmed |  |
| t2-pr-avatar-upload | glm-5 (r1, rubric) | confirmed |  |
| t2-pr-cursor-pages | glm-5 (r1, rubric) | confirmed |  |
| t2-pr-orders-migration | glm-5 (r1, rubric) | confirmed |  |
| t2-pr-price-cache | glm-5 (r1, rubric) | confirmed |  |
| t2-pr-refund-flow | glm-5 (r1, rubric) | confirmed |  |
| t2-pr-stock-reserve | glm-5 (r1, rubric) | confirmed |  |
| t2-sec-dr-sso-login | glm-5 (r1, rubric) | confirmed |  |
| t2-sec-pr-webhook-relay | glm-5 (r1, rubric) | confirmed |  |

## Spot-review fixes (2026-11-20, mate spot-review fix worker)

Who: claude (mate spot-review fix worker session), from the Fable spot-review pre-read (reports/spot-review-preread-t2-t4-t6-t7.md). Free gates after the edit: reference 100, stub 7.1, lazy 28.6 / 32, and a second correct review written in another style (other sections or lines, other words) 100 on both tasks, where the old key gave it 23.4 and 62.5. Non-Claude recheck: see `review.recheck` and reports/spot-review-fixes-2026-11-20.md.

- `lib/hidden/findings.test.cjs` (shared by every T2 task): a key item's `section` may be a list, and `also` lists more code spans ({file, line, endLine?}) for an item whose cause sits in two places. Every other T2 task's dry run is unchanged (16 of 16 pass with the same scores).
- `t2-arch-dr-two-regions` (version 4):
  - k2 was false against `data/replication-lag-measurements.csv` (it said the P99 lag exceeds 60 s; the CSV says 420-720 ms). It now names the real contradictions: RPO 60 s against the 30 s transactional RPO in `docs/service-targets.md`, and measured P99 lag 4-7 times the design's own < 100 ms target. Sections 6.3 or 3.2.
  - k3 (DNS TTL against the 60 s RTO) may sit at 6.2, 3.5, 3.6 or 6.1. k7 was the same finding split off; it is now the design's three different recovery times (120 s in 3.2, 90 s in 3.6, 60 s in 6.2) at any of those sections.
  - k4 may sit at 3.9 (where the figures are) or 8.1 and now names what the cost analysis really misses (storage priced once for two databases, Multi-AZ standbys, one-time cost over the $45,000 budget). k5 may sit at 3.7 or 7.1 and names the missing reconcile step. k8 moved from 2.2 (the dependency list) to 3.2 or 3.3 and from low to high. k1 may sit at 3.2 or 3.3.
  - Fixture `docs/design/active-active-regions.md`: Scenario 1 no longer states its own oversell ("Global count becomes -1", "Alert triggers"); it now ends with the count at 0 and no alert, so the reviewer has to see two buyers for one seat. Section 9 lost the three open questions that named the trap areas (synchronous replication, TTL, timestamp conflicts).
  - The reference review matches the corrected key.
- `t2-gaps-jwt-middleware` (version 4):
  - k2 was inverted. `Date.now() <= payload.exp` compares milliseconds with seconds, so every token that carries `exp` (every token login issues) is rejected, not kept valid. Text corrected, severity high to critical, `Math.floor` added to the fix words; the reference review says the same.
  - k1 also matches `src/security/token.js:37` (the header-chosen algorithm default) and `src/routes/session-routes.js:30`; k5 also matches `src/middleware/bearer-auth.js:32` (the `invalidAuthorization(rawToken)` call).
  - The request said "under fixture/pr/87"; the runner copies the fixture to the workspace root, so it now says "under pr/87".
