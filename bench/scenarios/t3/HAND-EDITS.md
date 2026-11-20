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
