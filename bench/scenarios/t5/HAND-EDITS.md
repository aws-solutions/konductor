# T5 hand edits

Owner rule (2026-11-19): every change that someone other than the recorded author made to a task's prompt, fixture, key, checks or rubric is listed here, and the task carries `handEdited`. Backfilled on 2026-11-20 by the HE hand-edit backfill session.

Sources: AUTHORING-LOG.md "edit" rows and notes, the git history, and a diff of the drafts (t5auth/work/<id>) against the landed tasks. The drafts in t5auth/work already carry the worker's earlier prompt edits, so the log is the record for those.

Every edited task was re-checked by a non-Claude model (gpt-5.6-luna, or glm-5 when the author was gpt-5.6-luna), run by kiro-cli in an isolated HOME, against a four-item checklist: the prompt names no method or decoy; the fixture does not list the answers; the key matches the fixture; the task is solvable from the fixture alone. The result is in `review.recheck`. A failed item is a `pilot.blockers` entry; the task is not fixed here.

## Batch notes

- hidden/<id>/mutation.test.js is built by lib/build-hidden.js from the author's mutants; the copies that differ from the draft were rebuilt by that script (mechanical) and are not listed again.
- expertKey on t5-qa-checkout-strategy and t5-qa-sync-strategy, and the rubric item expert-key that scores it, were written by the T5 worker session (commit c7a54967; no model call for them is logged).

## Edits by the batch worker

### t5-dev-legacy-characterize

- Who: claude (T5 batch worker session)
- What:
  - prompt: request reduced
  - checks: reduced; file-name checks removed
- Why: the prompt named the behaviours; file-name checks scored the layout instead of the work
- Recheck: glm-5, pass

### t5-qa-cart-twin-config

- Who: claude (T5 batch worker session)
- What:
  - hidden: folder layout fixed (shipping-config.test.js moved under hidden/)
  - checks: one check fixed
- Why: the hidden tests did not run from the author's layout
- Recheck: glm-5, pass

### t5-qa-cart-weak-tests

- Who: claude (T5 batch worker session)
- What:
  - prompt: named the exact boundaries to test; reduced to module level
  - prompt: appended "Yes, that scope is confirmed, and committing the work on the branch I am on is fine." (the target SOP needs the user's yes since PR #299; owner rule 2026-11-19)
- Why: the prompt gave away the traps; the consent sentence keeps an unattended run from stalling
- Recheck: glm-5, pass

### t5-qa-checkout-strategy

- Who: claude (T5 batch worker session)
- What:
  - prompt: the author's list of every risk area removed
  - checks: generic fix keywords tightened
  - key: expertKey added, with the rubric item expert-key
  - prompt: appended "Yes, that scope is confirmed, and committing the work on the branch I am on is fine." (the target SOP needs the user's yes since PR #299; owner rule 2026-11-19)
- Why: the prompt listed the answers; loose keywords let a shallow plan score; design tasks need a judge-only key
- Recheck: glm-5, pass

### t5-qa-flaky-fix

- Who: claude (T5 batch worker session)
- What:
  - hidden: stability test and preload rewritten to the scratch-root layout; child suite output stripped from failure messages
  - checks: replaced by a time-zone run, an assertion-count floor and the hidden tests
- Why: the bench's summary parser read the child suite output; the author checks did not measure the fix
- Recheck: glm-5, pass

### t5-qa-ledger-gaps

- Who: claude (T5 batch worker session)
- What:
  - prompt: named the exact boundaries to test; reduced to module level
  - prompt: appended "Yes, that scope is confirmed, and committing the work on the branch I am on is fine." (the target SOP needs the user's yes since PR #299; owner rule 2026-11-19)
- Why: the prompt gave away the traps
- Recheck: glm-5, pass

### t5-qa-parser-gaps

- Who: claude (T5 batch worker session)
- What:
  - fixture: a placeholder test file named like the solution file renamed
  - prompt: reduced to module level
  - checks: reduced to counts
  - prompt: appended "Yes, that scope is confirmed, and committing the work on the branch I am on is fine." (the target SOP needs the user's yes since PR #299; owner rule 2026-11-19)
- Why: the placeholder collided with the solution; the prompt named the cases
- Recheck: glm-5, pass

### t5-qa-scheduler-gaps

- Who: claude (T5 batch worker session)
- What:
  - prompt: appended "Yes, that scope is confirmed, and committing the work on the branch I am on is fine." (the target SOP needs the user's yes since PR #299; owner rule 2026-11-19)
- Why: the target SOP needs the user's yes, else an unattended run stalls
- Recheck: glm-5, pass

### t5-qa-security-tests

- Who: claude (T5 batch worker session)
- What:
  - fixture/hidden: the test entry was a file that required test-cases/; moved to a real test/ folder (src/util removed from the fixture)
  - prompt: reduced to module level
- Why: the test command did not find the tests; the prompt named the cases
- Recheck: glm-5, pass

### t5-qa-suite-audit

- Who: claude (T5 batch worker session)
- What:
  - checks: fix keywords need 2 matches; a wrong path prefix in a check fixed
  - prompt: appended "Yes, that scope is confirmed, and committing the work on the branch I am on is fine." (the target SOP needs the user's yes since PR #299; owner rule 2026-11-19)
- Why: one keyword let a shallow audit score; the path check never matched
- Recheck: glm-5, pass

### t5-qa-sync-strategy

- Who: claude (T5 batch worker session)
- What:
  - prompt and keyword checks tightened
  - key: expertKey added, with the rubric item expert-key
  - prompt: appended "Yes, that scope is confirmed, and committing the work on the branch I am on is fine." (the target SOP needs the user's yes since PR #299; owner rule 2026-11-19)
- Why: the prompt pointed at the risks; design tasks need a judge-only key
- Recheck: glm-5, pass

## Scorer fixes by the HE session

None: no lazy answer in this batch scored above 40, or none could be fixed by the scorer.

## Dry-run answers written by script (HE)

Not part of any task (the agent never sees them), logged here as the owner asked. `answers/<id>/lazy/` and `answers/<id>/alt/` were written by a script from the reference: the lazy answer keeps the reference's headings with generic sentences, keeps structured blocks in shape with generic values (a decision block takes a non-acceptable option from meta.json), leaves the code and policy files the reference changes as the fixture has them, and makes new test files smoke tests; the alternative answer is the reference with heading wording, section order, bullet markers and JSON key order changed, and a header comment on code. Both are mechanical variants, not independent answers. Scored with the batch's own free scorer; results in `pilot.dryRun`.

Tasks: none (every task already had a dry run).

## Not edited

t5-fe-widget-logic-tests, t5-qa-acceptance-criteria: `handEdited: null`.

## Rubric fixes after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task reviews of 2026-11-19 and 2026-11-20 (empty rubrics, single-item 0/15/30 dials, generic polish items). Each item now carries Fail, Partial and Pass anchors in its criterion text, because the rubric schema has no anchor field and the judge reads the criterion as written. Rubric changes do not move the code-only dry-run scores, so pilot.dryRun stands. Each task's version is bumped and handEdited names this session; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t5-qa-cart-twin-config`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): config-handling.

## Harder keys after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task reviews (T5 mutant tasks saturated at 100 and rewarding suite size; 10 tasks whose lazy answer scored 68.9 to 84.7 against the 40 gate). Shared changes: lib/hidden/mutants.js and mutation.test.js (safe refactors, suite-size budget, kills count only for a suite that passes the refactor), lib/hidden/block-key.js and block.test.js, lib/hidden/plan.test.cjs (gate items, section scoring). Dry runs re-recorded. Each task's version is bumped and handEdited names this session; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t5-dev-legacy-characterize`: prompt states the suite-size budget (45 = fixture 5 + 4 per mutant) and that tests must survive a behaviour-preserving rewrite; test-count condition removed from the visible-suite check (now the plain suite run, format, weight 1); anchored suite-economy rubric item added (weight 2); hidden kit: safe refactor r1 (private helpers and calculator state renamed); a mutant kill counts only when the suite also passes r1; suite-size test (max 45); guard checks made format (they pass on the untouched fixture, so they gave free points): fixture_unchanged rates.py.
- `t5-fe-widget-logic-tests`: prompt states the suite-size budget (53 = fixture 13 + 4 per mutant) and that tests must survive a behaviour-preserving rewrite; test-count condition removed from the visible-suite check (now the plain suite run, format, weight 1); anchored suite-economy rubric item added (weight 2); hidden kit: safe refactor r1 (field checks driven by a table); a mutant kill counts only when the suite also passes r1; suite-size test (max 53); guard checks made format (they pass on the untouched fixture, so they gave free points): fixture_unchanged src/date-range-picker.js.
- `t5-qa-cart-weak-tests`: prompt states the suite-size budget (57 = fixture 17 + 4 per mutant) and that tests must survive a behaviour-preserving rewrite; min_matches check removed (test\(): it counted or matched words, not test quality; contains check removed (expiresAtMs|freeShippingThresholdCents|discountedSubtotalCen): it counted or matched words, not test quality; not_contains check removed (skip|todo): it counted or matched words, not test quality; anchored suite-economy rubric item added (weight 2); hidden kit: safe refactor r1 (one reducer per discount kind); a mutant kill counts only when the suite also passes r1; suite-size test (max 57); guard checks made format (they pass on the untouched fixture, so they gave free points): fixture_unchanged src.
- `t5-qa-ledger-gaps`: prompt states the suite-size budget (54 = fixture 14 + 4 per mutant) and that tests must survive a behaviour-preserving rewrite; test-count condition removed from the visible-suite check (now the plain suite run, format, weight 1); anchored suite-economy rubric item added (weight 2); hidden kit: safe refactor r1 (constants renamed, rounding and system-account helpers extracted); a mutant kill counts only when the suite also passes r1; suite-size test (max 54); guard checks made format (they pass on the untouched fixture, so they gave free points): fixture_unchanged ledger/interest.py.
- `t5-qa-parser-gaps`: prompt states the suite-size budget (64 = fixture 24 + 4 per mutant) and that tests must survive a behaviour-preserving rewrite; test-count condition removed from the visible-suite check (now the plain suite run, format, weight 1); anchored suite-economy rubric item added (weight 2); hidden kit: safe refactor r1 (one numeric pattern, range check inlined); a mutant kill counts only when the suite also passes r1; suite-size test (max 64); guard checks made format (they pass on the untouched fixture, so they gave free points): fixture_unchanged src/parser.js.
- `t5-qa-scheduler-gaps`: prompt states the suite-size budget (65 = fixture 25 + 4 per mutant) and that tests must survive a behaviour-preserving rewrite; test-count condition removed from the visible-suite check (now the plain suite run, format, weight 1); anchored suite-economy rubric item added (weight 2); hidden kit: safe refactor r1 (queue kept as a sorted list, retry loop restructured); a mutant kill counts only when the suite also passes r1; suite-size test (max 65); guard checks made format (they pass on the untouched fixture, so they gave free points): fixture_unchanged schedulerlib/scheduler.py.
- `t5-qa-security-tests`: prompt states the suite-size budget (44 = fixture 4 + 4 per mutant) and that tests must survive a behaviour-preserving rewrite; min_matches check removed (test\(): it counted or matched words, not test quality; anchored suite-economy rubric item added (weight 2); hidden kit: safe refactor r1 (field limits table, documents kept in a map); a mutant kill counts only when the suite also passes r1; suite-size test (max 44); guard checks made format (they pass on the untouched fixture, so they gave free points): file_exists test/security.test.js, fixture_unchanged src/handlers/documents.js.
