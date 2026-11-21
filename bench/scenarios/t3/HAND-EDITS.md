# T3 hand edits

Owner rule (2026-11-19): every change that someone other than the recorded author made to a task's prompt, fixture, key, checks or rubric is listed here, and the task carries `handEdited`. Backfilled on 2026-11-20 by the HE hand-edit backfill session.

Sources: AUTHORING-LOG.md notes, commit e4881e6f, and a diff of the author drafts (t3work/<id>) against the landed task, fixture and hidden folders.

Every edited task was re-checked by a non-Claude model (gpt-5.6-luna, or glm-5 when the author was gpt-5.6-luna), run by kiro-cli in an isolated HOME, against a four-item checklist: the prompt names no method or decoy; the fixture does not list the answers; the key matches the fixture; the task is solvable from the fixture alone. The result is in `review.recheck`. A failed item is a `pilot.blockers` entry; the task is not fixed here.

## Batch notes

- Not counted as hand edits (mechanical, no content change): assemble.js builds the checks array from the author's hidden tests and meta.json deliverables, copies the fixture into hidden/<id>/_pristine and meta.json into hidden/, and rewrites each rubric item from {criterion, why_code_cannot_check} to {id, criterion with "(not code-checkable: ...)", weight 1}. normalize.js and finalize.js only strip the kind prefix from unit ids and merge the map and review results. Prompts and fixtures of all 22 tasks are byte-identical to the drafts.
- expertKey on every task was written by glm-5 in a recorded expertKey step (see AUTHORING-LOG.md), not by a Claude session.

## Edits by the batch worker

### t3-adr-cache-sizing-twin

- Who: claude (T3 batch worker session)
- What:
  - hidden: memory-table.test.js rewritten to accept any table layout (307 lines changed)
  - dry run: the lazy answer was written by hand
- Why: the author's test required one table layout, so a correct answer in another layout failed; a model-written lazy answer came out fully correct for this lookup task
- Recheck: gpt-5.6-luna, pass

### t3-db-audit-retention-twin

- Who: claude (T3 batch worker session)
- What:
  - hidden: retention-figures.test.js rewritten to accept any table layout
  - dry run: the lazy answer was written by hand
- Why: same as t3-adr-cache-sizing-twin
- Recheck: glm-5, pass

### t3-nfr-capacity-autoscale

- Who: claude (T3 batch worker session)
- What:
  - checks: tests command now loads hidden/gate.js with `node --require`
  - hidden: added hidden/gate.js
- Why: same as t3-nfr-latency-budget
- Recheck: gpt-5.6-luna, FAIL (key-matches-fixture, solvable-from-fixture)

### t3-nfr-latency-budget

- Who: claude (T3 batch worker session)
- What:
  - checks: tests command now loads hidden/gate.js with `node --require`
  - hidden: added hidden/gate.js (fails every non-structural test when the chosen option is not an acceptable one)
- Why: a lazy answer that picked the wrong option still passed most numeric tests
- Recheck: gpt-5.6-luna, FAIL (key-matches-fixture, solvable-from-fixture)

### t3-sre-log-retention

- Who: claude (T3 batch worker session)
- What:
  - checks: tests command now loads hidden/gate.js with `node --require`
  - hidden: added hidden/gate.js
- Why: same as t3-nfr-latency-budget
- Recheck: gpt-5.6-luna, FAIL (no-method-or-decoy, key-matches-fixture, solvable-from-fixture)

### t3-tpm-migration-cutover

- Who: claude (T3 batch worker session)
- What:
  - checks: tests command now loads hidden/gate.js with `node --require`
  - hidden: added hidden/gate.js
- Why: same as t3-nfr-latency-budget
- Recheck: glm-5, pass

## Scorer fixes by the HE session

Owner rule (2026-11-19, HE): when a shallow answer scores above 40, the scorer is fixed, not the task. These changes touch checks only (prompt, fixture, key and rubric unchanged), keep the code-checkable share as it was, and were re-scored free (reference, empty, lazy, alternative, twice). No paid recheck was run for them (owner: no paid calls for this step).

### t3-adr-cache-sizing

- Who: claude (HE hand-edit backfill session)
- What:
  - checks: tests command loads hidden/gate.js with `node --require` (copied from _shared/gate.js, the gate the T3 worker added to four tasks)
  - version bumped
- Why: the scripted lazy answer (the tempting option from meta.json with generic prose) scored above 40; with the gate it keeps only the structural tests
- After: reference 100, empty 0, lazy 18, alternative 100

### t3-arch-notification-pipeline

- Who: claude (HE hand-edit backfill session)
- What:
  - checks: tests command loads hidden/gate.js with `node --require` (copied from _shared/gate.js, the gate the T3 worker added to four tasks)
  - version bumped
- Why: the scripted lazy answer (the tempting option from meta.json with generic prose) scored above 40; with the gate it keeps only the structural tests
- After: reference 100, empty 0, lazy 12, alternative 100

### t3-db-audit-retention

- Who: claude (HE hand-edit backfill session)
- What:
  - checks: tests command loads hidden/gate.js with `node --require` (copied from _shared/gate.js, the gate the T3 worker added to four tasks)
  - version bumped
- Why: the scripted lazy answer (the tempting option from meta.json with generic prose) scored above 40; with the gate it keeps only the structural tests
- After: reference 100, empty 0, lazy 14, alternative 100

### t3-db-order-history

- Who: claude (HE hand-edit backfill session)
- What:
  - checks: tests command loads hidden/gate.js with `node --require` (copied from _shared/gate.js, the gate the T3 worker added to four tasks)
  - version bumped
- Why: the scripted lazy answer (the tempting option from meta.json with generic prose) scored above 40; with the gate it keeps only the structural tests
- After: reference 100, empty 0, lazy 6, alternative 100

### t3-pm-feature-scope

- Who: claude (HE hand-edit backfill session)
- What:
  - checks: tests command loads hidden/gate.js with `node --require` (copied from _shared/gate.js, the gate the T3 worker added to four tasks)
  - version bumped
- Why: the scripted lazy answer (the tempting option from meta.json with generic prose) scored above 40; with the gate it keeps only the structural tests
- After: reference 100, empty 0, lazy 13, alternative 100

## Dry-run answers written by script (HE)

Not part of any task (the agent never sees them), logged here as the owner asked. `answers/<id>/lazy/` and `answers/<id>/alt/` were written by a script from the reference: the lazy answer keeps the reference's headings with generic sentences, keeps structured blocks in shape with generic values (a decision block takes a non-acceptable option from meta.json), leaves the code and policy files the reference changes as the fixture has them, and makes new test files smoke tests; the alternative answer is the reference with heading wording, section order, bullet markers and JSON key order changed, and a header comment on code. Both are mechanical variants, not independent answers. Scored with the batch's own free scorer; results in `pilot.dryRun`.

Tasks: t3-adr-cache-sizing, t3-arch-notification-pipeline, t3-db-audit-retention, t3-db-order-history, t3-pm-feature-scope.

## Not edited

t3-adr-batch-vs-stream, t3-adr-db-engine, t3-adr-egress-cdn, t3-adr-multiregion-dr, t3-adr-queue-choice, t3-api-booking, t3-api-ingest-batch, t3-api-search-pagination, t3-db-tenant-isolation, t3-dev-lib-choice, t3-dev-module-boundary: `handEdited: null`.

## Rubric fixes after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task reviews of 2026-11-19 and 2026-11-20 (empty rubrics, single-item 0/15/30 dials, generic polish items). Each item now carries Fail, Partial and Pass anchors in its criterion text, because the rubric schema has no anchor field and the judge reads the criterion as written. Rubric changes do not move the code-only dry-run scores, so pilot.dryRun stands. Each task's version is bumped and handEdited names this session; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t3-adr-batch-vs-stream`: added anchored rejects-each-option (weight 2); removed generic polish item(s) documentation_quality.
- `t3-adr-cache-sizing`: added anchored rejects-each-option (weight 2); removed generic polish item(s) decision-quality.
- `t3-adr-db-engine`: added anchored rejects-each-option (weight 2); removed generic polish item(s) decision-record-quality.
- `t3-adr-egress-cdn`: added anchored rejects-each-option (weight 2); removed generic polish item(s) adr-clarity.
- `t3-adr-multiregion-dr`: added anchored rejects-each-option (weight 2); removed generic polish item(s) documentation-clarity.
- `t3-adr-queue-choice`: added anchored rejects-each-option (weight 2); removed generic polish item(s) explanation_clarity, professional_writing.
- `t3-api-booking`: added anchored rejects-each-option (weight 2).
- `t3-api-ingest-batch`: added anchored rejects-each-option (weight 2).
- `t3-api-search-pagination`: added anchored rejects-each-option (weight 2).
- `t3-arch-notification-pipeline`: added anchored rejects-each-option (weight 2); removed generic polish item(s) technical-communication.
- `t3-db-audit-retention`: added anchored rejects-each-option (weight 2).
- `t3-db-order-history`: added anchored rejects-each-option (weight 2).
- `t3-db-tenant-isolation`: added anchored rejects-each-option (weight 2).
- `t3-dev-module-boundary`: added anchored rejects-each-option (weight 2).
- `t3-nfr-latency-budget`: added anchored rejects-each-option (weight 2); removed generic polish item(s) explanation_clarity.
- `t3-pm-feature-scope`: added anchored rejects-each-option (weight 2); removed generic polish item(s) explanation_clarity.
- `t3-sre-log-retention`: added anchored rejects-each-option (weight 2).
- `t3-tpm-migration-cutover`: added anchored rejects-each-option (weight 2).

## FX2: t3-adr-multiregion-dr (2026-11-20)

- Who: claude (FX2 job)
- What:
  - checks: tests command loads hidden/gate.js with `node --require` (the shared gate.js)
  - hidden: .bench-lib.json names gate.js from bench/scenarios/lib/hidden (no per-task copy)
- Why: the fix by deepseek-3.2 made exactly one option acceptable and passed the reference, empty and alternative gates, but the lazy answer scored 55 (over 40) because the hidden tests that do not depend on the choice still pass; the owner rule of 2026-11-19 is to gate the scorer, as done for five other T3 tasks

## FX2: t3-adr-queue-choice (2026-11-20)

- Who: claude (FX2 job)
- What:
  - checks: tests command loads hidden/gate.js with `node --require` (the shared gate.js)
  - hidden: .bench-lib.json names gate.js from bench/scenarios/lib/hidden (no per-task copy)
- Why: after the fix by the original writer the shallow answer still scored over 40, because the hidden tests that do not depend on the chosen option still pass; the owner rule of 2026-11-19 is to gate the scorer, as done for five other T3 tasks

## Rubric anchors (2026-11-20)

- Who: claude (review-fix2 worker)
- What: 47 rubric criteria across 19 tasks now carry Fail / Partial / Pass anchors written from each task's answer key and fixture figures (reasoning, trade-off, clarity and calculation items). Ids, weights and expert-key items are unchanged; task versions are up by 1.
- Why: the independent review found these criteria had no anchors, so a judge could pass a shallow ADR on tone; each Pass now needs the key's figures and rejections.

## Non-Claude recheck (D-108, 2026-11-20, mate hand-edit recheck worker)

Every Claude hand edit above was checked again. Free first: the free gates (reference, empty, lazy, alternative) and
two scans (rubric anchors and hidden-test names found only in the reference, not in the request or fixture). Then a
non-Claude model ran the four-item checklist ("full": request, fixture, hidden key and rubric; "rubric": the rubric
edits, on top of the earlier non-Claude check of the request, fixture and key). Verdicts are in each task's
`review.recheck`; calls and credits in reports/hand-edit-recheck-2026-11-20.md.

| Task | Recheck | Result | Note |
| --- | --- | --- | --- |
| t3-adr-batch-vs-stream | glm-5 (c15, full) | fix needed | free key scan: the gate needs option id batch_2x_scaling and the tests need 5 limit names (processing_window_hours, monthly_budget_usd, ...) that neither the fixture nor the prompt gives; glm-5 passed it |
| t3-adr-cache-sizing-twin | glm-5 (r3, rubric) | confirmed |  |
| t3-adr-cache-sizing | glm-5 (r3, rubric) | fix needed | free key scan: limit names resident_hit_ratio_percent, monthly_budget_usd, rpo_minutes, rto_minutes are not in the fixture or prompt |
| t3-adr-db-engine | glm-5 (c14, full) | fix needed | free key scan: limit names peak_write_wps, read_p99_ms, rpo_seconds, rto_seconds, partition_write_wcu are not in the fixture or prompt |
| t3-adr-egress-cdn | glm-5 (c14, full) | fix needed | free key scan: limit name data_size_tb is not in the fixture or prompt |
| t3-adr-multiregion-dr | glm-5 (r3, rubric) | fix needed | free key scan: gate option id warm-standby and limit names rpo_min, rto_min, monthly_budget_usd are not in the fixture or prompt |
| t3-adr-queue-choice | glm-5 (r3, rubric) | fix needed | free key scan: limit names peak_throughput_per_second, fifo_throughput_per_group, monthly_budget_usd are not in the fixture or prompt |
| t3-api-booking | glm-5 (c14, full) | fix needed | free key scan: limit name response_body_bytes is not in the fixture or prompt; the Pass anchor of contract-boundary-reasoning lists reference field names (startsAt, endsAt) |
| t3-api-ingest-batch | glm-5 (c14, full) | fix needed | free key scan: limit name max_request_body_bytes is not in the fixture or prompt |
| t3-api-search-pagination | glm-5 (c15, full) | confirmed |  |
| t3-arch-notification-pipeline | glm-5 (r3, rubric) | fix needed | free key scan: limit name throughput_msg_s is not in the fixture or prompt |
| t3-db-audit-retention-twin | glm-5 (r3, rubric) | confirmed |  |
| t3-db-audit-retention | none | dropped | failed two earlier non-Claude rechecks (FX, FX2); no new call; the free key scan also finds limit names and option id 1-index missing from the fixture |
| t3-db-order-history | none | dropped | failed two earlier non-Claude rechecks; no new call; option ids composite-optimized, two-table-normalized are not in the fixture |
| t3-db-tenant-isolation | glm-5 (c15, full) | confirmed |  |
| t3-dev-module-boundary | glm-5 (c15, full) | confirmed |  |
| t3-nfr-latency-budget | glm-5 (r3, rubric) | fix needed | free key scan: limit names p99_latency_ms, monthly_budget_usd are not in the fixture or prompt |
| t3-pm-feature-scope | none | dropped | failed two earlier non-Claude rechecks; no new call |
| t3-tpm-migration-cutover | glm-5 (r3, rubric) | confirmed |  |

## D-127 key names, fixed by the writer family (2026-11-20)

The D-108 free scan found that the hidden tests of ten tasks read `limits` keys and option ids that neither the request
nor the fixture gives. Owner decision: state the names in the request, with the fix written by a non-Claude writer
family. The writer of each task changed its prompt only (and, for t3-api-booking, one rubric criterion); the mate
hand-edit recheck worker (claude) applied the files and bumped the versions. This is not a Claude edit, so
`handEdited` is unchanged. Free gates after the fix are unchanged, the scenarios lint is clean, and the name scan finds
no missing name.

| Task | Fixed by | What changed |
| --- | --- | --- |
| t3-adr-batch-vs-stream | deepseek-3.2 (f1) | prompt names the option ids (batch_current, batch_2x_scaling, batch_3x_scaling, streaming) and the five limit keys |
| t3-adr-multiregion-dr | deepseek-3.2 (f1) | prompt names the option ids (nightly-backup, pilot-light, warm-standby) and the limit keys monthly_budget_usd, rpo_min, rto_min |
| t3-adr-queue-choice | deepseek-3.2 (f1) | prompt names the option ids (sqs_standard, sqs_fifo, kinesis_streams) and three limit keys |
| t3-nfr-latency-budget | deepseek-3.2 (f1) | prompt names the option ids (base, parallel, cache, cache_parallel) and the limit keys monthly_budget_usd, p99_latency_ms |
| t3-adr-cache-sizing | gpt-5.6-luna (f2) | prompt maps each option id to the fixture's option and names the six limit keys |
| t3-adr-db-engine | gpt-5.6-luna (f2) | the same, three option ids and seven limit keys |
| t3-adr-egress-cdn | gpt-5.6-luna (f2) | the same, three option ids and six limit keys |
| t3-api-booking | gpt-5.6-luna (f3) | prompt names the six limit keys and the option ids cursor and offset; the contract-boundary-reasoning Pass anchor accepts any field names with the same meaning |
| t3-api-ingest-batch | gpt-5.6-luna (f3) | prompt names the six limit keys and maps the three option ids |
| t3-arch-notification-pipeline | gpt-5.6-luna (f3) | prompt names the six limit keys and maps the three option ids |

Second writer round (deepseek-3.2, f4), after the gpt-5.6-luna recheck (v1) found three more defects. Free gates after:
t3-adr-multiregion-dr 100 / 0 / 5 / 100, t3-adr-queue-choice 100 / 0 / 5 / 100.

| Task | Fixed by | What changed | Why |
| --- | --- | --- | --- |
| t3-adr-multiregion-dr | deepseek-3.2 (f4) | fixture `README.md` line 33 and `decision-options.md` line 94: "Meets all requirements" and "Meets both RPO and RTO requirements" became neutral descriptions | v1: fixture-lists-no-answer, the fixture said which option is right |
| t3-adr-queue-choice | deepseek-3.2 (f4) | `hidden/adr-validation.test.js`: the exact template headings, status value, Decision Drivers and Compliance sections and checkmarks are no longer required; content checks stay; the claude worker set the tests check `min` 43 to 42 to match the new test count | v1: key-matches-fixture and solvable-from-fixture, the tests demanded structure the request does not ask for |
| t3-adr-batch-vs-stream | not landed | deepseek-3.2 changed the request from Q4 to Q3 2025 to match the key, but the fixture still says "through Q4 2025" in requirements.md and gives two Q4 volumes (4.65 TB in performance-metrics.md and decision-criteria.md, 6.28 TB in data-growth.csv and traffic-analysis.md) | v1 found the key sized for 4.65 TB while the request says Q4 2025; the fixture contradicts itself, so the task stays fix (D-127) |

## Non-Claude recheck, round 2 (D-108, D-127, 2026-11-20, mate hand-edit recheck worker)

These rows replace the round 1 rows above for the same tasks.

| Task | Recheck | Result | Note |
| --- | --- | --- | --- |
| t3-adr-batch-vs-stream | gpt-5.6-luna (v1, full) | fix needed | names fixed (f1), but gpt-5.6-luna (v1) found the key sized for 4.65 TB while the request says Q4 2025; the fixture gives both 4.65 and 6.28 TB for Q4, and the writer fix (f4) only moved the request to Q3, so it was not landed; drop or rewrite |
| t3-adr-cache-sizing | deepseek-3.2 (v2, full) | confirmed after fix | D-127: the writer family named the limit keys and option ids in the request; free gates unchanged; non-Claude recheck after the fix |
| t3-adr-db-engine | deepseek-3.2 (v2, full) | confirmed after fix | D-127: the writer family named the limit keys and option ids in the request; free gates unchanged; non-Claude recheck after the fix |
| t3-adr-egress-cdn | deepseek-3.2 (v2, full) | confirmed after fix | D-127: the writer family named the limit keys and option ids in the request; free gates unchanged; non-Claude recheck after the fix; deepseek-3.2 failed key-matches-fixture because the stated key differs from the fixture field name, disposed: the request now states the key |
| t3-adr-multiregion-dr | gpt-5.6-luna (v4, full) | confirmed after fix | D-127 names (deepseek-3.2 f1), then the gpt-5.6-luna recheck found an answer leak in the fixture; deepseek-3.2 (f4) neutralised it; gpt-5.6-luna (v4) passes all four |
| t3-adr-queue-choice | gpt-5.6-luna (v4, full) | confirmed after fix | D-127 names (f1), then gpt-5.6-luna found tests demanding unrequested headings; deepseek-3.2 (f4) loosened them (min 43 to 42); gpt-5.6-luna (v4) passes all four |
| t3-api-booking | deepseek-3.2 (v3, full) | confirmed after fix | D-127: the writer family named the limit keys and option ids in the request; free gates unchanged; non-Claude recheck after the fix; deepseek-3.2 failed key-matches-fixture because the stated key differs from the fixture field name, disposed: the request now states the key |
| t3-api-ingest-batch | deepseek-3.2 (v3, full) | confirmed after fix | D-127: the writer family named the limit keys and option ids in the request; free gates unchanged; non-Claude recheck after the fix; deepseek-3.2 failed key-matches-fixture because the stated key differs from the fixture field name, disposed: the request now states the key |
| t3-arch-notification-pipeline | deepseek-3.2 (v3, full) | confirmed after fix | D-127: the writer family named the limit keys and option ids in the request; free gates unchanged; non-Claude recheck after the fix; deepseek-3.2 failed key-matches-fixture because the stated key differs from the fixture field name, disposed: the request now states the key |
| t3-nfr-latency-budget | gpt-5.6-luna (v1, full) | confirmed after fix | D-127: the writer family named the limit keys and option ids in the request; free gates unchanged; non-Claude recheck after the fix |

## Answer-key reconcile (2026-11-20, key-reconcile worker)

Who: claude (kirocrew-mate-worker, key-reconcile session), applying the reconciled Fable and Opus 5.5 answer-key passes
(reports/key-improve/reconciled.md in the mate workspace). Every `expertKey` item now holds one point with its
pass figure, accepted equivalents, a weak example and what not to require; items that only rewarded naming a
superseded figure are gone; `adjudication` is added. Each task has a new `answers/<id>/other` answer.

- `t3-adr-db-engine` (version 5): expertKey 9 items (adds 937.5 WCU headroom, 11 ms p99, scheduled launch capacity,
  shard operations, what changes the choice; drops the three repeats of the hot-partition point and the "superseded"
  item). Rubric `reasoning-quality` and `tradeoff-explanation` merged into `reasoning-and-tradeoffs` (weight 2).
  Free gates: reference 100, stub 6, lazy 39, alt 100, other 100.
- `t3-arch-notification-pipeline` (version 6): expertKey 7 items (adds regional spread, the topic-vs-stream trade
  with figures, the chosen design's downside). `tradeoff-analysis` anchors updated. The `other` answer picks
  stream-partitions. Free gates: reference 100, stub 0, lazy 12, alt 100, other 100.
- `t3-tpm-migration-cutover` (version 4): fixture `migration-model.json` no longer carries the `downtime_formula`
  string; `handoff_steps_min` becomes named steps and big bang is `copy_during_write_pause`; `change-calendar.md` says
  every handoff step runs inside the measured write pause and that big bang copies at the off-hours rate during it
  (same in `_pristine`); `hidden/decision.test.js` reads the new shape. expertKey 8 items (drops the two items met by
  copying change-calendar.md; adds seed lead time, writes lost after the switch, zero throughput margin). New lazy,
  alt (answers.js) and other answers. Free gates: reference 100, stub 0, lazy 16, alt 100, other 100.

## t3-adr-batch-vs-stream: one horizon (2026-11-20, deepseek-3.2 f5, owner decision)

The writer family (deepseek-3.2) rewrote the task so the request, fixture, key and answers agree on one planning
horizon: the next 4 quarters from 2024-Q3, ending 2025-Q3 at 4.65 TB. The 2025-Q4 row (6.28 TB) is gone from
`data-growth.csv` and `traffic-analysis.md`, every "Q4 2025" that meant the horizon now reads "Q3 2025", and the limit
key `data_volume_tb_q4_2025` is now `data_volume_tb_q3_2025` in the prompt, hidden test, reference and both answers.
`hidden/_pristine/` matches the fixture again. One expertKey weak answer still names 6.28 TB as a common mistake.
The mate hand-edit recheck worker (claude) copied back only the task's own files, since the writer had left scratch
copies inside `solution/`, and bumped the version to 5. Free gates: reference 100, empty 0, lazy 19, alternative 100;
the lint is clean and the name scan finds no missing name. The non-Claude recheck is still open: this call cost 22.6
of the 30 credits approved, so the 15-credit gpt-5.6-luna recheck did not fit. `pilot.decision` stays fix with a
recheck-pending blocker.

Recheck of the f5 rewrite: gpt-5.6-luna (v5, 2026-11-20) passes all four items. Its recheck.json lacked one closing
brace, which the worker added before reading it; the raw file is kept with the job's results. `pilot.decision` is
keep and the recheck-pending blocker is cleared (D-127 closed).

## Pilot wave 4 fixes (2026-11-20, mate hand-edit recheck worker, claude)

Pilot wave 4 ran plain Claude (vanilla, claude-sonnet-5.5) on 16 T3 tasks at 1072fc5d. Re-running each hidden suite on
the run's own workspace showed that five low scores came from the task, not from the answer. Each fix changes the
request (or one test), and the free gates are unchanged afterwards: reference 100, alternative 100, lazy 40 or less.

| Task | Date | What changed | Why (pilot evidence) |
| --- | --- | --- | --- |
| t3-dev-module-boundary | 2026-11-20 | prompt: the ADR goes to `docs/design.md` (was `solution/docs/design.md`); prompt names the seven `limits` keys (`memory_mb`, `latency_p95_seconds`, `throughput_per_second`, `payload_kb`, `rpo_minutes`, `rto_minutes`, `monthly_budget_usd`) and points at option-matrix.json for option ids | the agent wrote `solution/docs/design.md` as told, so the check command's `ln -sfn . solution` hit a real folder and exited 1 before any test ran ("hidden suite did not parse", score 14). With the file moved, its answer passes 11 of 19: the rest are limit key names the request never gave (`retry_memory_mb`, `dispatch_latency_p95_seconds`) |
| t3-adr-queue-choice | 2026-11-20 | fixture (and `_pristine`), tests, reference, answers, prompt, rubric, expertKey: SQS FIFO's 300 msg/s limit is per queue, because high-throughput mode is not enabled in this account; the runbook test held 300/s with 1 and with 8 groups; limit key `fifo_throughput_per_group` renamed to `fifo_throughput_per_queue`, and pricing-data `throughput_per_group` renamed to `throughput_per_queue` | the agent chose SQS FIFO with 2 or more message groups (200/s per group) and scored 32. The fixture only said "per message group", so its reading was correct and the trap was unfair |
| t3-api-booking | 2026-11-20 | prompt names the three paths, the list parameters (`roomId`, `from`, `to`, `cursor`, `pageSize`), the `Idempotency-Key` header and the `Error` schema | the agent's `limit` query parameter failed the two `pageSize` tests |
| t3-api-ingest-batch | 2026-11-20 | prompt names `/v1/ingest-batches` and `/v1/ingest-batches/{batchId}`, the `readings`, `results` and `state` fields, and the `Idempotency-Key` header; the hidden test accepts any OpenAPI 3.x (was exactly 3.1.0, like t3-api-booking now) | the agent's `/v1/batches` paths and `openapi: 3.0.3` failed 6 of 19 tests |
| t3-db-tenant-isolation | 2026-11-20 | prompt names the `tickets` table and the nine columns the hidden seed inserts | the seed inserts `ticket_id`, `title`, `priority` and `assignee`; the agent's schema used other names, so 5 of 20 tests failed on the insert |

## D-144: the tests check survives an agent-made solution/ (2026-11-20, mate hand-edit recheck worker, claude)

Checks only. All 19 tasks: in the `tests` check command, `ln -sfn . solution` became `( [ -L solution ] || [ ! -e solution ] || mv solution .bench-agent-solution ) && ln -sfn . solution`, and each version went up by 1. Before, a real `solution/` folder made the `ln` fail. That ended the `&&` chain before `node --test`, so the run read as an unparsed hidden suite (pilot wave 4, t3-dev-module-boundary). Now the agent's folder is moved aside and the tests read the deliverables at the paths the request gives. Free gates are unchanged on all 19 tasks. The new `test/check-cmd.test.js` checks the guard on a folder, a file, a link and nothing. No prompt, fixture, key or rubric changed, so no recheck was needed.

## t3-tpm-migration-cutover: reference meets the reconciled key; real alternative (2026-11-20, mate hand-edit recheck worker, claude)

D-141 judge pass (gpt-5.6-luna, deepseek-3.2, qwen3-coder-next): the reference scored a panel median of 73.4, and all three judges failed e4 (the seed lead time). The "alt" that got 50 in the wave 4 controls was a byte copy of that reference. So the anchors were fair: the reference predated the reconciled key and lacked its new points. Version 5 to 6.

| Task | Date | What changed | Why |
| --- | --- | --- | --- |
| t3-tpm-migration-cutover | 2026-11-20 | `solutions/.../docs/cutover.md` gains two sections. "Timing, go condition and rollback": the seed takes 8.3 h at the 60 MB/s spare (67 min off hours), so it starts by Saturday 17:00; go at lag under 120 s; abort at the 8-minute pause budget; the checkpoint and the point of no return. "Margins and cost basis": 150 MB/s equals the minimum, the flip at 6,700 USD or 0.54 TB, the 6,700 sum, labor excluded, and the 400 USD support line kept. The decision block is unchanged | the reconciled key items e2, e4 to e8 had no passage in the reference |
| t3-tpm-migration-cutover | 2026-11-20 | `answers/.../alt/docs/cutover.md` rewritten as an independent answer: an option table, a "before Sunday" seed plan and a numbered Sunday runbook, with the same decision block | the alt was a copy of the reference, so it said nothing about whether other wording passes |

Free gates after the change: reference 100, empty 0, lazy 16, alt 100, other 100. Judged again ($0.022): the reference scored 100 from all three judges under the paraphrase rule, and its raw verdicts are within 1.1 points of each other. Under the lenient rule it is 68.8, because deepseek and qwen restated instead of quoting. The new alt scored a median of 87.5 (68.8 lenient). deepseek-3.2 (v9, 2026-11-20, a family that did not write the task or the edit) passes the four-item checklist on this version, alt included; the verdicts are in `review.recheck`.

## t3-db-order-history v6 (2026-11-21, mate debt worker, DEBT D-155)

The new `fixture-tells` lint rule found that `constraints.txt` told the agent how it is graded and where the trap is:
a "Validation Requirements" section opened with "Hidden tests will verify:" and listed them, and an "Important Notes"
section said "The "tempting" option is indexing every column separately", with its 3.1 TB total and the Premium fee.
Both sections are gone from the fixture and from the hidden `_pristine` copy. The facts the agent needs are still in
the fixture: `prototype-results.md` projects 3.1 TB at 900M rows and `pricing-guide.md` gives the Premium fee and the
Standard limit. Free gates after: reference 100, stub 0, lazy 6, alt 100. Needs a non-Claude recheck at v6.

## Round 6 recheck of t3-db-order-history v6 (2026-11-21, gpt-5.6-luna, call L13)

1 of 4 passes, so nothing is recorded in `review.recheck`. Listed for independent review (Fable), not disposed.
- fixture-lists-no-answer: `prototype-results.md:55-62` gives the query plans of the recommended option, and
  lines 97-104 call Option 2 the primary recommendation.
- key-matches-fixture and solvable-from-fixture: `hidden/options.test.js:8-14` needs the ids `composite-optimized` or
  `two-table-normalized`, but the fixture names the options A-D (`README.md:38-42`) or 1-3 (`prototype-results.md`).
  The rubric uses the same ids. This is the D-127 finding that dropped the task before; `pilot.decision` now reads keep.

## t3-db-order-history v7 (2026-11-21, mate free-fix worker, claude; Fable review D2)

`reports/review-probe-disposals-fable.md` D2: the hidden tests read the option ids `composite-optimized` and
`two-table-normalized` and the limits keys `storage_tb`, `iops`, `throughput_mbps` and `monthly_budget_usd`, but no
fixture file or the prompt named them. The prompt now has one sentence naming the three option ids (mapped to Options
1 to 3 of `prototype-results.md`) and the four limits keys, the way the nine D-127 siblings were fixed (for example
t3-adr-db-engine). It names no choice. Key, checks and fixture unchanged. Gates: reference 100, stub 0, lazy 6, alt
100. Non-Claude recheck: pending (`handEdited.version` 7).
