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
