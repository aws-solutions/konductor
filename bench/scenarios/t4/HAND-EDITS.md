# T4 hand edits

Owner rule (2026-11-19): every change that someone other than the recorded author made to a task's prompt, fixture, key, checks or rubric is listed here, and the task carries `handEdited`. Backfilled on 2026-11-20 by the HE hand-edit backfill session.

Sources: edits/<id>.json (every change after the draft, with its reason), AUTHORING-LOG.md "Hand edits after review", the git history, and a diff of the drafts (t4auth/work/<id>/task-draft.json) against the landed tasks.

Every edited task was re-checked by a non-Claude model (gpt-5.6-luna, or glm-5 when the author was gpt-5.6-luna), run by kiro-cli in an isolated HOME, against a four-item checklist: the prompt names no method or decoy; the fixture does not list the answers; the key matches the fixture; the task is solvable from the fixture alone. The result is in `review.recheck`. A failed item is a `pilot.blockers` entry; the task is not fixed here.

## Batch notes

- expertKey on every task that has one was written by the T4 worker session (no model call for it is in AUTHORING-LOG.md), so it counts as a hand edit of the key.
- Limits changes are listed for completeness; they are not part of the prompt, fixture, key, checks or rubric.

## Edits by the batch worker

### t4-arch-tenant-abac

- Who: claude (T4 batch worker session)
- What:
  - prompt rewritten: the draft named the mechanisms (ForAllValues on leading keys, s3:prefix, an explicit deny); it now states the requirements, including that a missing tag and support access must be refused even if another policy allows them, which is what the hidden tests check
  - checks that grepped the policy for operator names replaced (the evaluator already decides); the fixture already holds a draft docs/access-model.md and shared policies, so the doc check looks for the tier tag and the policy check for service-wide allows (deny statements may be broad)
  - limits raised from 15/30 to 1200/2400 s
  - expertKey added
- Why: each reason is given with its change (from edits/t4-arch-tenant-abac.json)
- Recheck: glm-5, pass

### t4-dev-path-traversal-files

- Who: claude (T4 batch worker session)
- What:
  - author changed from deepseek-3.2 to gpt-5.6-luna (the deepseek calls of this batch ran past 30 minutes), reviewed by glm-5
  - prompt rewritten (the list of attack strings removed)
  - checks: source-text checks (O_NOFOLLOW, path.relative) removed; the ci.yml check failed on the reference because the fixture had an empty .github folder, so the lead added a plain CI workflow to the fixture and dropped the check
  - visible suite check made format (the hidden suite already covers normal use), and a behavioural check added (a neighbour folder with a shared name prefix, by relative and by absolute path) so the checks share does not pass on the fixture
  - limits raised from 180/360 to 1200/2400 s
  - expertKey added
- Why: each reason is given with its change (from edits/t4-dev-path-traversal-files.json)
- Recheck: glm-5, pass

### t4-dev-sql-report-filters

- Who: claude (T4 batch worker session)
- What:
  - fix round by the author (deepseek-3.2): src/__init__.py, hint docstring removed, hidden suite rebuilt to 33 tests
  - prompt rewritten by the lead (no defect locations, default-order rule stated so every sort test is fair)
  - source-text regex checks replaced by a behavioural injection check and the visible suite
  - limits 1200/2400 s
  - lead: removed 10 hidden tests that pass on the vulnerable code too (sqlite3 rejects their payloads anyway), and merged the 5 normal-use regression tests into one test with subtests, so the suite (19 tests) measures the fix: 1 of 19 passes on the fixture
  - expertKey added (judge-only; items the hidden tests or evaluator already check are left out)
- Why: each reason is given with its change (from edits/t4-dev-sql-report-filters.json)
- Recheck: gpt-5.6-luna, FAIL (key-matches-fixture, solvable-from-fixture)

### t4-iac-review-terraform

- Who: claude (T4 batch worker session)
- What:
  - fix round by the author (deepseek-3.2): answer comments removed, PR state moved into the fixture, solution is REVIEW.md only, decoy and padding tests require a real answer
  - lead: review/PR-142.diff deleted (hand-written, corrupt, and there is no base tree); PR-142.md lists every changed file instead
  - lead: security notes that listed two defects removed from docs/reporting.md
  - prompt rewritten; checks replaced (the draft ran npm test inside a fixture/ folder that the workspace does not have)
  - limits kept at 900/1800 s
  - expertKey added (judge-only; items the hidden tests or evaluator already check are left out)
- Why: each reason is given with its change (from edits/t4-iac-review-terraform.json)
- Recheck: gpt-5.6-luna, FAIL (fixture-lists-no-answer, key-matches-fixture, solvable-from-fixture)

### t4-iam-bucket-policy-oac

- Who: claude (T4 batch worker session)
- What:
  - prompt rewritten (the draft listed the service principals, the conditions and each trap)
  - hidden: CDN positive test added (a deny-all answer passed everything); deploy role evaluated with identity and bucket policy together; lint tests merged; two log tests that passed on the fixture removed
  - checks: npm test ran inside a fixture/ folder the workspace does not have; text checks replaced
  - solution/DELETE.txt removed (comment lines only)
  - expertKey added
- Why: each reason is given with its change (from edits/t4-iam-bucket-policy-oac.json)
- Recheck: gpt-5.6-luna, FAIL (key-matches-fixture, solvable-from-fixture)

### t4-iam-ci-deploy-role

- Who: claude (T4 batch worker session)
- What:
  - prompt rewritten (traps removed)
  - hidden: all-calls test split into deploy and rollback tests (16 to 17 tests)
  - package.json unchanged check made format, so fixture-passing substance weight is 20%
  - limits raised from 180/360 to 900/1800 s
  - expertKey added (judge-only; items the hidden tests or evaluator already check are left out)
- Why: each reason is given with its change (from edits/t4-iam-ci-deploy-role.json)
- Recheck: glm-5, pass

### t4-iam-ci-deploy-role-twin

- Who: claude (T4 batch worker session)
- What:
  - fix round by the author (deepseek-3.2) did not make the suite pass the reference (18 of 22)
  - lead: hidden suite replaced by one file of 14 tests (temp manifest per test, per-file retry counters, no recursive node --test, no unstated rules such as which errors are not retried)
  - prompt rewritten to state the full interface (a twin is a control: stating the interface is fine; it must not touch IAM)
  - checks: grep checks on deploy.js removed; visible suite, IAM policy and config unchanged
  - loadCheck.mustNotLoad holds the IAM skills, which a twin exists to catch
  - limits 900/1800 s
- Why: each reason is given with its change (from edits/t4-iam-ci-deploy-role-twin.json)
- Recheck: gpt-5.6-luna, FAIL (key-matches-fixture, solvable-from-fixture); cleared by hand on 2026-11-20 as a false alarm (see the FX section)

### t4-iam-lambda-role-split

- Who: claude (T4 batch worker session)
- What:
  - prompt rewritten (traps removed)
  - checks: the text checks on one file replaced by one check that no function policy holds a wildcard action or resource
  - limits raised from 15/30 to 1200/2400 s
  - expertKey added (judge-only; items the hidden tests or evaluator already check are left out)
- Why: each reason is given with its change (from edits/t4-iam-lambda-role-split.json)
- Recheck: glm-5, pass

### t4-iam-privesc-groups

- Who: claude (T4 batch worker session)
- What:
  - author: the first author call (deepseek-3.2) was stopped after 34 minutes by the batch rule (30 minutes); authored again by gpt-5.6-luna, reviewed by glm-5
  - prompt rewritten (the draft listed the escalation routes and jobs)
  - checks: statement-id checks (TeamExecutionRoleOnly, RejectAdministrativeActions, UserProvisioning) the prompt never names replaced by one check on NotAction allows in any group policy
  - limits raised from 90/180 to 1200/2400 s
  - validate.js check made format and the NotAction check weighted 3, so checks that pass on the fixture stay at 25% of substance weight (stub 25.3 before)
  - expertKey added
- Why: each reason is given with its change (from edits/t4-iam-privesc-groups.json)
- Recheck: glm-5, pass

### t4-iam-vendor-trust

- Who: claude (T4 batch worker session)
- What:
  - prompt rewritten (the draft listed every fix: external ids, the org condition, which session actions to allow and deny, the exact monitoring scope)
  - checks: text checks that required one action name replaced by checks on the two worst grants
  - limits raised from 8/16 to 1200/2400 s
  - expertKey added (judge-only; evaluator-checked items left out)
- Why: each reason is given with its change (from edits/t4-iam-vendor-trust.json)
- Recheck: glm-5, pass

### t4-policy-fix-accessdenied

- Who: claude (T4 batch worker session)
- What:
  - prompt rewritten (traps and the hidden evaluator name removed)
  - statement-id checks replaced by checks on broad grants
  - rubric item for the explanation the prompt asks for
  - limits raised from 180/360 to 900/1800 s
- Why: each reason is given with its change (from edits/t4-policy-fix-accessdenied.json)
- Recheck: glm-5, pass

### t4-secrets-in-repo

- Who: claude (T4 batch worker session)
- What:
  - author: the first author call (deepseek-3.2) was stopped after 31 minutes by the batch rule; authored again by gpt-5.6-luna, reviewed by glm-5
  - prompt rewritten (the file list removed; loadConfig fields, the scan scope and the no-value rule stated)
  - checks: package.json exact-command regex relaxed to the script name (hidden test 01 checks the command)
  - limits raised from 180/360 to 1200/2400 s
  - hidden: the planted-file helper made its temp folder before its try block and leaked it when the script was missing (stub run); fixed
  - expertKey added
- Why: each reason is given with its change (from edits/t4-secrets-in-repo.json)
- Recheck: glm-5, pass

### t4-threat-model-webhooks

- Who: claude (T4 batch worker session)
- What:
  - prompt rewritten (component, decoy and area lists removed)
  - keyword check on constant-time made a format check
  - no-dependency check dropped (package.json is a docs fixture; keeps the share of checks that pass on the fixture at 25%)
  - limits raised from 180/360 to 900/1800 s (plan: soft at least 3x the longest pilot run)
  - expertKey added (judge-only; seeded threats stay in the hidden script, so the key holds what a script cannot check)
- Why: each reason is given with its change (from edits/t4-threat-model-webhooks.json)
- Recheck: glm-5, pass

## Fix round by the FX job (2026-11-20)

The four tasks whose recheck failed were sent back to their writer family (deepseek-3.2) with the reviewer's findings, then rechecked by gpt-5.6-luna (a non-Claude family that is not the writer). The calls and credits are in AUTHORING-LOG.md.

### t4-dev-sql-report-filters

- Who: deepseek (the fix), claude (FX job, the correction)
- What:
  - deepseek-3.2 edited the fixture docs and database.py, and added a warning comment and docs/security.md that named the vulnerability and the fix
  - claude reverted those two additions and the wording that stated the wildcard rule, so the fixture says "substring search" in docs/api.md and in the database.py docstrings only
  - claude added one sentence to the prompt: a name or customer filter is a plain text search, matched as typed, so `%` and `_` in it match only that character
  - version 2
- Why: the hidden tests require literal wildcards and nothing visible said so; the writer's own fix leaked the answer into the fixture
- Recheck: gpt-5.6-luna, pass

### t4-iam-ci-deploy-role-twin

- Who: claude (FX job)
- What: the two failed recheck items set to pass and the blockers removed; no change to the task, fixture or tests
- Why: false alarm; the recheck folder laid the hidden overlay one directory too deep. Reference 100 and empty 19.7 by dry-run.js, 14 of 14 hidden tests

### t4-iac-review-terraform, t4-iam-bucket-policy-oac

Fixed by deepseek-3.2 alone (no hand edit): see AUTHORING-LOG.md. Both version 2, recheck pass.

## Scorer fixes by the HE session

None: no lazy answer in this batch scored above 40, or none could be fixed by the scorer.

## Dry-run answers written by script (HE)

Not part of any task (the agent never sees them), logged here as the owner asked. `answers/<id>/lazy/` and `answers/<id>/alt/` were written by a script from the reference: the lazy answer keeps the reference's headings with generic sentences, keeps structured blocks in shape with generic values (a decision block takes a non-acceptable option from meta.json), leaves the code and policy files the reference changes as the fixture has them, and makes new test files smoke tests; the alternative answer is the reference with heading wording, section order, bullet markers and JSON key order changed, and a header comment on code. Both are mechanical variants, not independent answers. Scored with the batch's own free scorer; results in `pilot.dryRun`.

Tasks: none (every task already had a dry run).

## Not edited

None.

## Edits after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task review of 2026-11-19
(T1 to T4 report, finding 1). Each task's `version` is bumped and `handEdited` names this session. No paid call ran,
so no non-Claude recheck exists yet: the tasks are on the recheck list in `bench/DEBT.md` D-108.

### t4-arch-tenant-abac

- What: no task change. The shared evaluator `lib/hidden/iam-eval.js` now keeps `${*}`, `${?}` and `${$}` as literal
  characters through `globToRegExp` (with a unit test in `t4/lib/iam-eval.test.js`). Before, `${*}` became a wildcard,
  so a correct deny on a literal `*` tenant matched every tenant and 38 allow tests failed (pilot score 69).
  `answers/t4-arch-tenant-abac/alt` is now an independent design (the pilot's vanilla answer, with an escaped-literal
  deny), not the reference with its keys reordered.
- Why: the tests rejected a policy that real IAM accepts.
- Dry run: reference 100, stub 14.7, lazy 14.7, alt 96.7. The five other IAM tasks score as before.

### t4-iam-privesc-groups

- What: the hidden "cannot" tests check the outcome (`decide` over identity plus boundary refuses the request), not
  that the group policy holds an explicit Deny. Each refusal counts only when the group can still do its guide's work,
  so a boundary that allows nothing earns nothing. One new test: the boundary is a real ceiling (an allow-everything
  member still cannot create policy versions, attach user policies or pass the admin role). PassRole requests carry
  `iam:PassedToService` as IAM sends it. Tests check `min` 26 to 27. `answers/.../alt` is now an independent
  boundary-deny design (the pilot's vanilla answer).
- Why: the old tests demanded where the Deny sits; the prompt says the boundary applies to every group, so a
  boundary deny is refused the same way in IAM (pilot score 67 for a correct answer).
- Dry run: reference 100, stub 17.7, lazy 17.7, alt 100.

## Rubric fixes after the task review (2026-11-20, mate task-fix worker)

Who: claude (mate task-fix worker session), owner-approved fixes from the task reviews of 2026-11-19 and 2026-11-20 (empty rubrics, single-item 0/15/30 dials, generic polish items). Each item now carries Fail, Partial and Pass anchors in its criterion text, because the rubric schema has no anchor field and the judge reads the criterion as written. Rubric changes do not move the code-only dry-run scores, so pilot.dryRun stands. Each task's version is bumped and handEdited names this session; no non-Claude recheck yet (bench/DEBT.md D-108).

- `t4-dev-path-traversal-files`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): root-cause-containment.
- `t4-dev-sql-report-filters`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): parameterised-design.
- `t4-iac-review-terraform`: prioritization given Fail/Partial/Pass anchors.
- `t4-iam-bucket-policy-oac`: proper_private_handling given Fail/Partial/Pass anchors.
- `t4-iam-ci-deploy-role-twin`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): change-explained.
- `t4-iam-lambda-role-split`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): traceable-least-privilege.
- `t4-iam-vendor-trust`: rubric was empty (the judge share was 0 and the code share took 100%); added anchored item(s): trust-design-explained.
- `t4-policy-fix-accessdenied`: cause given Fail/Partial/Pass anchors.
- `t4-threat-model-webhooks`: review-quality replaced by anchored attacker-path-fix (weight 2).
