# T1 hand edits

Every change to a T1 task's prompt, fixture, key, checks or rubric made by anyone other than its recorded author. The editor of every row below is the T1 worker, a Claude session (family `claude`, editor `t1-worker`). Each listed task carries `handEdited` and gets a non-Claude checklist re-review (`review.recheck`: no method or decoy in the prompt, the fixture lists no answer, the key matches the fixture, the task is solvable from the fixture alone) before lock.

| task | date | what changed | why |
| --- | --- | --- | --- |
| t1-bug-cache-ttl | 2026-11-19 | checks: the no-dependency `cmd` check became `kind: format`; the regression-test check weight 2 to 3; the changelog check weight 1 to 2 | the untouched fixture scored 25.7 (two guard checks passed on it); after the change the stub scores 19.0 and the reference 100 |
| t1-nfr-report-queries | 2026-11-19 | checks: the `tests` command gained a prefix that asserts Python 3.12 (`python3 -c "import sys; assert sys.version_info[:2] == (3, 12)" && ...`); expertKey: five items and five weak answers written by the worker, each citing a public source | the bench pins Python only for checks that name python, and a wrong interpreter must fail loudly; the expert-key rule arrived after the author call |
| t1-nfr-startup-lazy | 2026-11-19 | checks: the `not_contains "dependencies"` check on package.json became `kind: format`; rubric: `weight: 1` added to both items (the author left it out) | the check passes on the untouched fixture (stub 21.4 before, 18.4 after); the schema requires a rubric weight |
| t1-ref-schema-migrate | 2026-11-19 | prompt: added "(a value that is NULL, empty or only whitespace counts as blank)" after "nonblank address" | the reviewer found a hidden test relies on whitespace-only addresses being blank, which the request did not say |
| t1-ref-esm-migrate | 2026-11-20 | fixture: `lib/manifest.json` renamed to `lib/module-map.json`, and the `require` / `import` of it changed in `fixtures/.../lib/manifest.js`, `solutions/.../lib/manifest.js` and `answers/.../alt/lib/manifest.js`; version 1 to 2 | `bench/.gitignore` ignores every `manifest.json`, so the file was never committed and the reference scored 50 from a clean checkout (DEBT D-104). The request and the hidden tests never name the file, so nothing else changed. Dry run after: reference 100, stub 18.3, shallow 37.8, lazy 29.7, alternative 87.8 |

Mechanical changes made by `stage.js assemble` to every task, not counted as hand edits: `limits` raised to at least 600 s soft and twice that hard; a missing rubric `weight` set to 1; a `source` added to each expert-key item from the task's own `authorship.source` when the author gave none.

## Rubric fixes after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task reviews of 2026-11-19 and 2026-11-20 (empty rubrics, single-item 0/15/30 dials, generic polish items). Each item now carries Fail, Partial and Pass anchors in its criterion text, because the rubric schema has no anchor field and the judge reads the criterion as written. Rubric changes do not move the code-only dry-run scores, so pilot.dryRun stands. Each task's version is bumped and handEdited names this session; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t1-bug-cache-ttl`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored root-cause-minimal (weight 2) on the change itself.
- `t1-bug-date-range`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored root-cause-minimal (weight 2) on the change itself.
- `t1-bug-event-listeners`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored root-cause-minimal (weight 2) on the change itself.
- `t1-bug-http-retry`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored root-cause-minimal (weight 2) on the change itself.
- `t1-impl-cli-envprefix`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-job-retry`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-money-split`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-rate-limit`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-settings-expand`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-impl-webhook-verify`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-nfr-ndjson-stream`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-nfr-report-queries`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-nfr-startup-lazy`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-ref-callbacks`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-ref-dep-upgrade`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-ref-esm-migrate`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.
- `t1-ref-schema-migrate`: one-item rubric (a 0/15/30 dial on honest reporting only); added anchored design-fit (weight 2) on the change itself.

## Free-gate repair after the independent review (2026-11-20, mate review-fix2 workers)

Who: claude (two mate review-fix2 worker sessions and the review-fix2 lead), from the independent review of 2026-11-20 (fix 1: T1 shallow gates; fix 3: anchors). Every T1 rubric item now has Fail, Partial and Pass anchors. Each task's version is bumped, handEdited names this session, and pilot.dryRun holds the numbers below. No non-Claude recheck yet (bench/DEBT.md D-108). Numbers are reference / stub / lazy / alt, before -> after.

| task | date | what changed | why |
| --- | --- | --- | --- |
| t1-bug-cache-ttl | 2026-11-20 | hidden: sweep() runs mid-scenario in 8 tests with stats asserted; prompt names test/cache-regressions.test.js; honest-verification anchored. 100/19/71.4/85.7 -> 100/9.5/33.3/85.7 | lazy 71.4 skipped the sweep-counter bug; the regression-file check was not stated in the prompt |
| t1-impl-rate-limit | 2026-11-20 | new hidden key-before-body.test.js; file-name checks replaced with config/test.json and limiter-test checks; alt repaired (key before body, bound, LRU counter); lazy answer rewritten by hand (see below); honest-verification anchored. 100/16.6/83.6/83.6 -> 100/15.7/38.9/100 | review fix 1; checks named reference files the prompt never gives; the model-written lazy was a complete answer |
| t1-bug-date-range | 2026-11-20 | hidden rebalanced to 4 tests per bug, TZ-pinned night counts; prompt asks for one regression test per problem; exact-code and file-name checks replaced by a test count; anchored. 100/14.3/52.4/81 -> 100/15/37/100 | lazy 52.4 (the midnight bug had 7 tests, the clock change 2); checks tied to reference code text |
| t1-bug-event-listeners | 2026-11-20 | 3 hidden heartbeat tests; note check accepts a changelog or ops note covering all fixes; test count replaces regressions.test.js; alt repaired (allSettled, socket close); anchored. 100/12.2/42.9/68.4 -> 100/11.3/36.6/100 | lazy 42.9; alt failed on reference-only names and phrases |
| t1-impl-job-retry | 2026-11-20 | prompt defines jitter; hidden run()/availableAt tests loosened off reference internals; alt jitter repaired; test-count and notes checks replace a file name and a README check the fixture already passed; anchored. 100/13/41.2/20.8 -> 100/5.2/36/100 | alt timed out on a test that needed run() to return when idle |
| t1-impl-settings-expand | 2026-11-20 | hidden error tests check the setting and source file, not wording; defaults test split; alt repaired (env-only names, default on missing); checks loosened off docs/cli.md, tests/expansion.test.js, expandValues; anchored. 100/10.8/42/63.1 -> 100/14.3/38.1/100 | error wording and internal names are not stated in the prompt |
| t1-impl-cli-envprefix | 2026-11-20 | test/env-prefix.test.js and src/config.js checks replaced by a test count, a SYNCER_ test and a show-config docs check; alt repaired (default vs config source labels); anchored. 100/6.3/9.5/75.2 -> 100/8.2/16.3/100 | alt failed on reference-only file names |
| t1-twin-webhook-routes | 2026-11-20 | hidden webhook-sentence test loosened to a line naming POST /webhooks/payment; empty rubric filled with 2 anchored items; lazy answer rewritten by hand (see below). 100/0/76.8/91.1 -> 100/0/14.3/100 | alt failed on exact wording; review: empty rubric |
| t1-impl-money-split | 2026-11-20 | name-agnostic checks (export, test count, docs grep); alt rewritten as src/alloc.js; anchored. 100/9.5/24.5/20.8 -> 100/9.5/35.9/100 | alt failed on file names and was a wrong solution |
| t1-impl-webhook-verify | 2026-11-20 | prompt sentence fixing options.secrets as an array and webhookSecrets / webhookToleranceSeconds; name-agnostic checks; alt config fixed; anchored. 100/17.3/32.7/32.7 -> 100/19.7/35/100 | hidden tests relied on shapes the prompt did not state |
| t1-neg-config-alias | 2026-11-20 | prompt sentence (both keys carried, warning on every load); 3 hidden tests added, index.js grep loosened; alt fixed; rubric left empty (declared unjudged negative control). 100/0/29.3/49.6 -> 100/0/24.4/100 | shallow was over 40 and alt failed on unstated behavior |
| t1-nfr-startup-lazy | 2026-11-20 | name-agnostic checks plus a loader-hook check (--help loads 4 or fewer modules); alt cli.js repaired; anchored. 100/18.4/23.1/65.3 -> 100/19/23.8/100 | alt loaded 5 modules on --help; checks named files the prompt did not |
| t1-nfr-ndjson-stream | 2026-11-20 | 8 hidden tests (test_edges.py); name-agnostic checks (array("Q") replaced by a memory command); anchored. 100/14.3/58.2/83.7 -> 100/11.3/37.2/100 | lazy was 58 and the alt failed on implementation names |
| t1-ref-callbacks | 2026-11-20 | hooks tested in callback form; async-retry test replaced; 2 CLI exit-code tests; name-agnostic checks; alt bin fixed; lazy answer rewritten by hand (see below); anchored. 100/11.6/67.9/67.9 -> 100/11.1/49.6/100 | tests required promise hooks the prompt does not state; lazy still over 40 (D-118) |
| t1-ref-dep-upgrade | 2026-11-20 | source regexes accept a local columns variable; docs pattern loosened; lazy answer rewritten by hand (see below); anchored. 100/19/81/90.5 -> 100/19/23.8/100 | alt failed on variable names; the model-written lazy's src/report.js was identical to the reference |
| t1-ref-schema-migrate | 2026-11-20 | new direction-repeat.test.js (3 tests); test-count check replaces a file-name check; lazy answer rewritten by hand (see below); anchored. 100/16.5/78.4/88.6 -> 100/15.6/49.2/100 | alt failed on a file name; "either direction twice" was half tested; lazy still over 40 (D-118) |
| t1-bug-http-retry, t1-nfr-report-queries, t1-ref-esm-migrate | 2026-11-20 | rubric anchors only | review fix 3 |

Hand-written lazy answers (the review-fix2 lead). Five model-written lazy answers were complete or near-complete solutions, so they could not show whether a shallow answer scores low (the same thing happened to the T3 twins, see the T3 log). Each was replaced with the shallow answer an agent that skims the request would give, and each still makes a real attempt at the main ask:
- t1-impl-rate-limit: one key header, the free limit for everyone, no window reset, no RateLimit or Retry-After headers, no client bound, config/test.json not updated.
- t1-twin-webhook-routes: the table has no Handler file column and there is no webhook sentence.
- t1-ref-dep-upgrade: the require path and function names are swapped to v2, but no columns and no compact option are passed.
- t1-ref-callbacks: only runPipeline gains a promise form; processFile, retry and FileStore stay callback-only.
- t1-ref-schema-migrate: the migration is written, but src/customer-repository.js is not updated.

## Merge of origin/feat/bench-pilot-nk (2026-11-20, t1-worker)

The merge with the other session's gate fixes (d4d31105) had no conflicts; all of its lazy, alternative and anchor changes are kept as they are. One follow-up, in the `pilot` field only (no prompt, fixture, key, check or rubric change): `pilot.decision` was still `fix` on tasks whose recorded `pilot.dryRun` now meets every free gate (reference 95+, stub 20-, lazy 40-, alternative 80+), so it was set to `keep` on: t1-bug-cache-ttl, t1-bug-date-range, t1-bug-event-listeners, t1-impl-cli-envprefix, t1-impl-job-retry, t1-impl-money-split, t1-impl-rate-limit, t1-impl-settings-expand, t1-impl-webhook-verify, t1-neg-config-alias, t1-nfr-ndjson-stream, t1-nfr-startup-lazy, t1-ref-dep-upgrade, t1-twin-webhook-routes. t1-ref-callbacks and t1-ref-schema-migrate were left unchanged (owner ruling pending, D-118).

## D-118 scoring fix (2026-11-20, lead session, family claude)

Owner ruling D-118: a half-done answer must score 40 or less. Both tasks keep their hand-written half-done lazy answer. Only the scoring changed, so the lazy answer itself was not touched.

| Task | What changed | Why | Free gates after (reference / stub / lazy / alt) |
| --- | --- | --- | --- |
| t1-ref-callbacks (v4) | `hidden/api.test.js`: the four preservation tests are now one test. They are concurrency, result order, the empty summary and CLI success, and the untouched code passes them too. The tests check `min` drops from 18 to 15. The five non-test checks (own suite passes, 8 or more tests, no new dependency, CHANGELOG, README mentions promises) are now `kind: format`: reported, not scored. | The lazy answer migrated only `runPipeline`. It still scored 49.6, because it passed the four keep-behaviour tests and every cheap check. It now passes 5 of 15 hidden tests. | 100 / 0 / 33.3 / 100 |
| t1-ref-schema-migrate (v4) | `hidden/`: seven one-test files are merged into two tests. `plumbing.test.js` covers the twelve old files kept, the new file exporting both directions, the CLI JSON, and version 13 recorded once. `up-backfill.test.js` covers the table created, legacy columns dropped, fields copied, and duplicates kept apart. The tests check `min` drops from 17 to 12. The five non-test checks are now `kind: format`. | The lazy answer wrote the migration but left the repository untouched. It scored 49.2 on wiring and backfill basics plus cheap checks. It now passes 4 of 12 hidden tests. | 100 / 0 / 33.3 / 100 |

No test was removed: every old assertion still runs inside the merged tests. Both dry runs repeated 3 times with the same result, and the canary and per-test timeouts pass. No model call was made. A non-Claude re-check of this scoring edit has not been run yet.
