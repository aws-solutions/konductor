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

## D-134 scan fixes (2026-11-20, mate spot-review fix worker)

Who: claude (mate spot-review fix worker session), from the free scan in reports/spot-review-fixes-2026-11-20.md (bench/DEBT.md D-134).

- `t2-arch-dr-event-store` (version 4) and `t2-dr-search-reindex` (version 4): the request named the document under `fixture/` (`fixture/docs/adr/0007-event-sourced-orders.md`, `fixture/docs/design/zero-downtime-reindex.md`). The runner copies the fixture to the workspace root, so that path does not exist; the request now says `docs/...`. Free gates unchanged: reference 100, stub 7.1, lazy 28.6, alt 100.
- `t2-sec-dr-sso-login` (version 3): key item k8 (section 3.5.2, "state parameter described as 32 bytes ... though not strictly a violation") is removed from `hidden/key.json`, `findingsKey` and the reference review. A 32-byte random state is more than the 128 bits RFC 6749 asks for, so k8 rewarded flagging a non-defect and cost a correct review 1 of 8 items (the reference without it scored 87.5 % of the findings score on the old key, 100 % now). The key has 7 items. Free gates: reference 100, stub 7.1, lazy 28.6, alt 100.
  - Found by the gpt-5.6-luna recheck: expert key item e1 said "PKCE is not mentioned", but `docs/design/sso-sign-in.md:13` says the flow uses Authorization Code with PKCE, so e1 rewarded a false finding. e1 now asks how the PKCE code verifier is generated, kept and bound to the browser session, which the design never says (no fixture file names a verifier or challenge). Judge-only, so the code dry run does not move.

## Answer-key reconcile (2026-11-20, key-reconcile worker)

Who: claude (kirocrew-mate-worker, key-reconcile session), applying the reconciled Fable and Opus 5.5 answer-key passes
(reports/key-improve/reconciled.md in the mate workspace).

- `t2-arch-dr-event-store` (version 5):
  - Fixture `docs/adr/0007-event-sourced-orders.md`: four sentences that confessed planted gaps are deleted (end of 4.1
    snapshots, 5.1 missing outbox option, 5.2 reporting replacement, 7.2 personal data left in events). The gaps stay
    provable from the packet.
  - `hidden/.../key.json`: `section` becomes a list where the flaw is visible in more than one section (k1 3.2/3.5,
    k2 3.3/2.3/9.1, k3 6.2/3.4, k4 7.2/3.2/3.5, k7 5.2/7.1); fix words widened (k1 event version, upcast, schema
    registry; k2 read-after-write, read after write, read your write, read from the event store; k4 crypto, shred,
    pseudonym, erasure; k6 snapshot interval, snapshot policy; k7 sql access, read replica, reporting schema).
  - `expertKey`: nine items beyond the seeded findings, one point each, no "Asks..." verbs (measured 11-minute restore,
    global checkpoint position, monthly partitions against the key, poison event, 2,400 USD budget, dual-path split,
    team fit, backfill parity, OrderUpdated contract). Rubric r1 anchored on the read-your-writes and replay findings;
    new r2 (council decision). `adjudication` added.
  - New answer `answers/t2-arch-dr-event-store/other/REVIEW.md`: a different correct review (other wording, findings in
    neighbouring sections, new fix words). Free gates: reference 100, stub 7.1, lazy 28.6, alt 100, dump 28.6, other 100.

## Delegated-read fix (2026-11-20, mate spot-review fix worker)

- `t2-arch-dr-two-regions` (version 5): k1 (last-write-wins sells a seat twice) and k6 (the global counter has no merge rule) were one defect, so one strong finding earned k1 and lost k6. k6 is merged into k1 (sections 3.2 or 3.3, fix words of both); the key has 7 items; the reference review lists it once. A review with one merged finding scores 100 (about 87 before, per the delegated read). Free gates: reference 100, stub 7.1, lazy 28.6, alt 100.

## t2-pr-price-cache v4 (2026-11-21, mate debt worker, DEBT D-100)

The fixture's `test/store.test.mjs` made a `catalog-test-` dir in TMPDIR and never removed it, so every run of the
visible suite left one behind. The test now removes it in `t.after`. The pull request under review does not touch this
file, and no key item reads it. Free gates unchanged: reference 100, stub 7.1, lazy 32, alt 100, dump 28.6. A case in
`bench/runner/test/temp-leaks.test.js` fails on the old file. Non-Claude recheck: pending (`handEdited.version` 4).

## Judge-vs-code fixes (2026-11-21, mate judge-vs-code worker, claude)

From `reports/judged-pilot-waves-4-12-2026-11-21.md`: every wave 6 pr- review got 100 from the three judges and 49 to
58 on code. Read against the reviews, the grader was at fault: literal keyword phrases, greedy pairing and a 1.5x
length cap (fixed in the shared grader, `139a3665` and `3447c9d7`), and key items that named one line where the
defect shows at two. The key edits below accept the other place or the reviewer's words; no item was dropped.

| Date | Task | Who | What changed | Why |
| --- | --- | --- | --- | --- |
| 2026-11-21 | t2-pr-price-cache v5 | claude (mate judge-vs-code worker) | `key.json`: k3 also at `src/services/price-service.mjs:14`; k5 also at `price-service.mjs:12-15` | k3 (seconds passed as milliseconds) shows where `set` gets `this.ttlSeconds`; k5 (cached array returned by reference) shows where `list` returns it. The wave 6 review named those lines. |
| 2026-11-21 | t2-pr-avatar-upload v4 | claude (mate judge-vs-code worker) | `key.json`: k2 also at `user_handler.py:239`; k3 also at `image_helpers.py:32`, finding rewritten, fix words structural / signature / decode added; k7 also at `user_handler.py:278`, fix words docs / delete the previous added | k3's finding said only the Content-Type is checked, but `validate_image_file` does sniff the bytes with `imghdr` (line 32); the real defect is that the sniff is weak (polyglots pass), which the review said. k2 (no size limit) shows where Content-Length is read; k7 (docs promise deletion) can be fixed in the code or the docs. |
| 2026-11-21 | t2-pr-cursor-pages v4 | claude (mate judge-vs-code worker) | `key.json`: k1 also at `src/api/issues.js:20`, fix words after the last row; k2 also at `src/pagination/cursor.js:3`, fix word tiebreaker | k1's repeated row comes from the cursor encoded at line 20 as much as the `>=` at 18; k2 (no stable order) was named at the offset cursor with "id as a sort tiebreaker". |
| 2026-11-21 | t2-pr-stock-reserve v3 | claude (mate judge-vs-code worker) | `key.json`: k6 fix words inject a clock | The review's fix for the 15 ms real-time wait was "Inject a clock". |
| 2026-11-21 | t2-gaps-jwt-middleware v5 | claude (mate judge-vs-code worker) | `key.json`: k4 also at `src/middleware/bearer-auth.js:29-30` | The role claim is taken from the token where the middleware returns `verified.payload`, which is where the review named it. |

Wave 6 runs scored again with the current grader (no model call): avatar 93.2, cursor 76.2, orders-migration 80.5,
price-cache 83, refund-flow 86.4, stock-reserve 90.3, webhook-relay 86.4, jwt-middleware 100 (were 49 to 59). Gates of
all 16 T2 tasks unchanged: reference 100, stub 7.1, lazy 28.6 to 35.1, alt 100, dump 28.6 to 35.7. Non-Claude recheck:
pending for the five tasks above.

<<<<<<< HEAD
## Round 6 non-Claude recheck (2026-11-21, mate recheck worker)

deepseek-3.2 (call D5) passed t2-pr-price-cache v5, t2-gaps-jwt-middleware v5, t2-pr-cursor-pages v4 and
t2-pr-stock-reserve v3, 4 of 4 each. gpt-5.6-luna (call L5) failed t2-pr-avatar-upload v4 on two items. (1)
key-matches-fixture: `findingsKey` k3 in the task file still said the upload checks only the Content-Type, while the
fixture runs `imghdr` and the hidden key's k3 was already reworded to "trusts the Content-Type and only sniffs the leading
bytes". Fixed (claude, by hand): the task file's k3 text now matches the hidden key; version 4 to 5. (2)
fixture-lists-no-answer: `docs/security.md` lists the upload rules; disposed, because those are the project's existing
rules the PR must be checked against, and the defects are in `pr/418/changes.diff`. A second gpt-5.6-luna recheck follows.
=======
## Version bump for the 2026-11-21 judge-vs-code edits (mate debt worker, DEBT D-150)

The judge-vs-code edits of 2026-11-21 changed these tasks without a new version, so an older recheck still cleared the lock. Each is now one version up with `handEdited.version` set, and `bench/scenarios/content-lock.json` records it; `scenarios ready` blocks the lock until a non-Claude recheck records that version. No content changed in this step.
>>>>>>> origin/feat/bench-pilot-nk

After the D-150 bumps (9a8697f4, version field only, content unchanged): the round 6 rechecks above move to the bumped
versions (t2-gaps-jwt-middleware v6, t2-pr-cursor-pages v5, t2-pr-stock-reserve v4). The k3 sync is a content change, so
t2-pr-avatar-upload goes to v6 (content-lock.json recorded); its gpt-5.6-luna recheck L6 read that content.

## t2-dr-notify-fanout v4 (2026-11-22, mate LITE-fix worker 2, owner-assigned fixer gpt-terra; LITE analysis item 11)

The LITE analysis said konductor's review of this task missed key items k3, k4 and k6. Read against the saved
reviews, the places are right: every run has a finding at 5.5, 5.4.2 and 5.6. The misses are fix keywords. K r1 wrote
"no outbound rate limiter ... token-bucket limiter" (key words "rate limiting", "throttling"), "Run at least two AZs"
(key words "multi-zone", "availability zone"), and a design capacity of 10,000/s against an observed peak of 550/s
(key words "capacity planning", "traffic analysis"). The `fix` lists of those three items now also hold the wording
such findings use: k3 "design capacity", "observed peak", "over provision", "overprovision", "right size"; k4 "throttl",
"rate limit", "token bucket"; k6 "multi az", "two az", "across az", "cross az", "single az". Location, severity and the
other four items are unchanged. The 3x length allowance was already in place (3447c9d7); it is not changed.
Re-grade of the six saved reviews (`analysis-fix11-regrade.js`): matched items K r1 4 to 7, V r1 4 to 7, K r2 6 to 7, V r2
6 to 7, K r3 7 to 7, V r3 5 to 7; score K r1 0.264 to 0.476, K r2 0.325 to 0.408, K r3 0.413 to 0.431, V r1 0.307 to
0.557, V r2 0.407 to 0.471, V r3 0.270 to 0.410. Both arms now find all 7 items in every run, so the key no longer
separates them by recall; the scores differ only by the length term (21 findings allowed, 33 to 45 written) and
severity. The length term still takes about half of every score and the prompt does not state a limit: left for the
owner. Gates: reference 100, stub 7.1, lazy 28.6, alt 100, dump 28.6. Non-Claude recheck: pending (`handEdited.version` 4).

## t2-dr-notify-fanout-v5 (2026-11-24, mate task-key-fix worker, claude; LITE fault 4)

New versioned task and key (`t2-dr-notify-fanout-v5.json`, `hidden/t2-dr-notify-fanout-v5/hidden/key.json`); the base
task (v4) and its key are unchanged. The request sets no cap on the number of findings, yet the key scaled any list
past 21 findings by 21 / reported; the LITE reviews held 27 to 48 findings, so the term took about half of every
score in every arm. The v5 key writes `"lengthAllowance": null`, which the shared hidden test (`lib/hidden/
findings.test.cjs`) now reads as "no length term"; precision is still reported. The v4 keyword fix (k3, k4, k6) is
kept. Re-score of the 21 saved LITE runs: the fixed keywords alone lift the hidden share from 20 to 45% to 30 to 55%;
with the length term gone it is 65 to 90% (every run but one finds 6 or 7 of the 7 seeded defects). Gates: reference
100, stub 7.1, lazy 28.6, alt 100, dump 28.6 (the dump baseline stays under the gate without the length term).
Non-Claude recheck: pending (`handEdited.version` 5).

## t2-dr-notify-fanout-v6 and t2-arch-dr-split-checkout-v4 (2026-11-24, mate key-rewrite worker, claude; key validity audit)

New versioned tasks and keys (`hidden/<id>-vN/hidden/key.json`, written and checked by
`bench/scenarios/rewrite-keyword-keys.js`); the base tasks and keys are unchanged. A seeded defect named at its section
earns nothing unless the finding's fix or issue holds a fix keyword (`fixRequired` in the shared hidden test); the key
validity audit of the LITE runs found the lists too narrow for the wording correct reviews use. Split review: k1
(shared storage) missed in 18 of 21 runs that named section 3.2 (reviews wrote "owning team", "single writer", "write
only its own tables", "written approval"; the list had service-owned schema, stop direct writes, separate database);
k2 (compensation) in 20 of 21 ("void the authorization", "release the reservation", "reserve before authorizing"; the
list had saga, compensating action, durable workflow); k3 in 12, k4 in 10. Fan-out review after its v4 keywords: k1 in 4
of 18 ("ledger", "claim", "collapse key"), k2 in 1, k4 in 2. Each item's list is now an alternative set made from the
saved runs of every arm (the sets are the data in `rewrite-keyword-keys.js`; derivation in
`reports/task-key-fixes-2026-11-24-data/synonyms.txt`); the gate itself stays, so a generic remark at a section still
earns nothing. The split review also gets `"lengthAllowance": null` (no length term; the request sets no cap), as the
fan-out review has since v5. Sections, severities and the three structural checks are as before. Gates: reference 100,
stub 7.1, lazy 28.6, alt 100, dump 28.6. Re-score of the saved LITE runs: split review 52 to 67 -> 93 to 95 per arm,
fan-out 46 to 52 -> 85 to 91. Both now sit in a narrow band near the top (the audit's section on discrimination).
Non-Claude recheck: pending (`handEdited.version`).
