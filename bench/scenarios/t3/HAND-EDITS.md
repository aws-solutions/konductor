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
