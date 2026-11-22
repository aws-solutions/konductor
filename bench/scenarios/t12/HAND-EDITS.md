# T12 hand edits

Owner rule (2026-11-19): every change that someone other than the recorded author made to a task's prompt, fixture,
key, checks or rubric is listed here, and the task carries `handEdited`.

All four tasks were written by hand on 2026-11-20 by the mate task-fix worker (claude), owner-approved, with no author
or reviewer model call. So the whole task is a Claude hand edit: `authorship.family` is claude, `handEdited` names
the worker, and every task is on the non-Claude recheck list (bench/DEBT.md D-108). The design review was a careful
self-review: the sub-agent tool of that session could not pick a model, so the requested second-family reviewer did
not run.

Self-review checklist, per task: the prompt names deliverables and constraints, not a method or the traps; every key
item can be derived from the fixture; a correct answer worded or ordered differently passes (the alternative answers
score 100); the shallow fake scores 0 to 22 and the half answer 0 to 36.4.

| Task | Edits during authoring |
| --- | --- |
| t12-spec-rate-limits | key: open questions folded into the requirements section, task items for the remaining-requests header and store failure added (the half answer scored 50 with three sections); the alternative keeps task order (the prompt says order matters) |
| t12-handoff-export-dates | key: legacy-not-affected fact, both-zones check before the pull request, and pull-request evidence added (the half answer scored 66.7); prompt: "without asking anyone" replaced (scenarios lint no-ask rule) |
| t12-parallel-backlog | reference: A2 moved to the second wave (waves list items by start, an item that waits goes later); prompt: a sentence that pointed at the code overlaps removed (it hinted at the trap); hand-written alternative plan |
| t12-sdlc-contact-import | hidden tests regrouped from 12 cases to 5 rules (all cases of a rule in one test); a hand-written half-done importer replaced the mechanical lazy answer, which kept the full code |

## Review fix 2 (2026-11-20, mate review-fix2 worker, claude)

From the independent review of 2026-11-20 (fixes 7 and 8). No model call. Every task moved to version 2.

| Task | Date | What changed | Why |
| --- | --- | --- | --- |
| t12-spec-rate-limits | 2026-11-20 | alt answer rewritten by hand (rules grouped by caller, ids LIM-1..7, sliding window from two counters, `src/limits/` modules, tests first, fail open to a per-instance count); fixture test command `node --test test/*.test.js` | the old alt was the reference reworded; `node --test test/` fails on Node 22 and later |
| t12-sdlc-contact-import | 2026-11-20 | alt answer rewritten by hand (state-machine record reader in `src/csv-records.js`, `book.add()` gives the skip reasons, `RowLimitError`, two test files); hidden rule 5 accepts any Error; key `dec-parser` also accepts reader, tokenizer or lexer; prompt, `cmd` check and fixture use `node --test test/*.test.js` | old alt was reworded; the prompt asks only for an Error and does not name a parser, so the key was tied to the reference's wording; `node --test test/` fails on Node 22+ |
| t12-handoff-export-dates | 2026-11-20 | prompt: the fix must be finished from the hand-off alone as a second step that writes `docs/handoff/BILL-1187-result.md` (readFiles, changedFiles, ranCommands, doneWhen); new hidden `work.test.js` (8 checks, each counted twice) with `.bench-base/`; checks now `fixture_unchanged` on `src/legacy` and `test/fixtures` instead of all of `src` and `test`; rubric item `finished-from-handoff` (anchored); reference gains the fix, the regression test and the result; lazy is now the full hand-off with no second step; alt rewritten by hand (numbered walk-through, `toISOString()` fix, new `test/format-date.test.js` setting the zone in-process); timeout 1800 s | review fix 8: the task planned a hand-off but never required anyone to finish from it; review fix 7: the old alt was reworded |
| t12-parallel-backlog | 2026-11-20 | prompt: carry the plan out, each package in `work/<P>/` with only its files and a `REPORT.md`, merged in mergeOrder with `docs/plan/merge-log.md`; new hidden `work.test.js` (12 checks, each counted twice: isolation, reports, merge replay from `.bench-base/`, final files, merge log order, A5 before A4, and the release outcome); `fixture_unchanged` on `src` replaced by `docs/team.md`; rubric item `packages-done-apart` (anchored); reference gains four packages, the merged code and the log; lazy is now the full plan with no work; alt gains six packages built independently (nested `config/app.json` with a flattening loader, first-failure login window, explicit CSV `COLUMNS`, CI matrix); CI check accepts any form naming both zones; timeout 2400 s | review fix 8: the task planned parallel work but never required it to be done and merged; the CI regex was tied to the reference's form |

## Batch CV-A (2026-11-20, mate CV-A worker, claude)

Owner-approved additions from the coverage review of 2026-11-20 (additions 1, 2 and 7). Each was written by hand by
this Claude worker, so the whole task is a Claude hand edit: `authorship.family` is claude, `authorship.singleFamily`
is set, `handEdited` names the worker, and a non-Claude family rechecks it with the written checklist
(`review.recheck`). Self-check before the recheck: the prompt asks for the behaviour (separate workers, worktrees,
merges, clean-up; or "work through the inbox as the team works") and names no skill, SOP, agent or trap; the fixture
lists no answer; every key value follows from the fixture's tickets, policy and CONTRIBUTING.md; a different correct
answer scores 100.

| Task | Date | What was written or changed | Why |
| --- | --- | --- | --- |
| t12-delegated-worker-fix | 2026-11-20 | new task: parcel-desk fixture with its own git repository (two issues, PD-41 weights, PD-44 business days), hidden tests per issue plus a merged-result test, `work.json` for the shared grader `lib/hidden/git-work.js`; reference, alt, lazy (one issue done) and shallow (both fixed straight on main) as scripted git agents (`PLAY.json`) | addition 1: the parent must hand two isolated fixes to workers; scored from branches, merges, code and clean-up only |
| t12-delegated-worker-fix | 2026-11-20 | fixture: dropped an unused `HOLIDAYS` require from `src/eta.js` before the git build | it pointed at the fix |
| t12-delegated-worker-fix | 2026-11-20 | `phase` multi-phase with `phases2` bugfix and code-review (was implementation and review) | the loader refused `review` and a repeated main phase |
| t12-sop-route-choice | 2026-11-20 | new task: booking-desk fixture with its own git repository, an inbox of four requests (live refund bug, agreed BK-215, unsigned waitlist, a patch to review); `work.test.js` scores each route from what it leaves (code and tests, the spec at the CONTRIBUTING path, the review's json block, the commit order) | addition 2: route choice scored from the final artifacts' paths and order |
| t12-sop-route-choice | 2026-11-20 | hidden test: regression tests are found by putting back the route's source file (was: by the words in the test file); the order test looks at the first commit that does route work (was: the first commit) and green is checked where each request ends (was: after every commit) | a test file for one request also matched the other; a test-first commit is a correct answer and fails its suite on purpose |
| t12-cmux-parallel-merge | 2026-11-20 | new task: shelf fixture with its own git repository, three tickets (CMX-1 bug, CMX-2 and CMX-3 new commands that share the command registry and the CLI test, so the merges conflict); the shared grader plus a merged-result test | addition 7: the cmux outcome; cmux is not on the bench host, so the gates are proven with the reference and the runtime gap is a DEBT row |
| t12-cmux-parallel-merge | 2026-11-20 | hidden CMX-2 test: the limit error is matched by its message only (was: anchored with `Error:`) | a correct RangeError would have failed |

## Fixes from the non-Claude recheck (2026-11-20, mate hand-edit recheck worker, claude)

D-108 recheck: gpt-5.6-luna (openai) checked all four tasks with the four-item checklist. It passed
t12-handoff-export-dates and t12-spec-rate-limits and found one defect each in the other two. Both fixes are in the
hidden tests only; versions 2 to 3. Free gates after the fix: unchanged (t12-parallel-backlog 100 / 0 / 20 / 100,
t12-sdlc-contact-import 100 / 0 / 36.4 / 100).

| Task | Date | What changed | Why |
| --- | --- | --- | --- |
| t12-parallel-backlog | 2026-11-20 | `work.test.js` "the limit is a setting": the setting's key path may name login, auth, attempt or fail (was login only) | backlog A4 asks for a configurable limit and names no key, so `auth.maxFailedPerMinute` was failed (recheck: key-matches-fixture, solvable-from-fixture) |
| t12-sdlc-contact-import | 2026-11-20 | `hidden-import.test.js` rule 1: blank lines may be ignored or skipped; only blank lines may appear in `skipped` | the request says nothing about blank lines, and "a row with no name is skipped with its line" is a fair reading of one (recheck: key-matches-fixture, solvable-from-fixture) |

## Non-Claude recheck (D-108, 2026-11-20, mate hand-edit recheck worker)

Every Claude hand edit above was checked again. Free first: the free gates (reference, empty, lazy, alternative) and
two scans (rubric anchors and hidden-test names found only in the reference, not in the request or fixture). Then a
non-Claude model ran the four-item checklist ("full": request, fixture, hidden key and rubric; "rubric": the rubric
edits, on top of the earlier non-Claude check of the request, fixture and key). Verdicts are in each task's
`review.recheck`; calls and credits in reports/hand-edit-recheck-2026-11-20.md.

| Task | Recheck | Result | Note |
| --- | --- | --- | --- |
| t12-handoff-export-dates | gpt-5.6-luna (c06, full) | confirmed |  |
| t12-parallel-backlog | gpt-5.6-luna (s1, full) | fix needed | gpt-5.6-luna (c06) found the login-only key match too narrow; fixed in this job, and its second pass (s1) passes the key and solvable items; the second pass fails no-method-or-decoy because the request lays out the plan, package and merge steps: owner call, that process is the T12 deliverable |
| t12-sdlc-contact-import | gpt-5.6-luna (s1, full) | fix needed | gpt-5.6-luna (c06) found the blank-line rule unstated; fixed in this job, and its second pass (s1) passes the key and solvable items; the second pass fails no-method-or-decoy because the request lists the SDLC steps: owner call, that process is the T12 deliverable |
| t12-spec-rate-limits | gpt-5.6-luna (c06, full) | confirmed |  |

The four tasks above have no author review, and the task schema keeps a recheck only inside a review, so their
gpt-5.6-luna verdicts are recorded here and not in the task files. c06 (all four): t12-handoff-export-dates and
t12-spec-rate-limits pass all four items; t12-parallel-backlog and t12-sdlc-contact-import fail key-matches-fixture and
solvable-from-fixture (fixed above). s1 (the two fixed tasks): key-matches-fixture, fixture-lists-no-answer and
solvable-from-fixture pass; no-method-or-decoy fails because the request lays out the process (D-127).

## Prompts state the outcome, not the process (2026-11-20, mate hand-edit recheck worker, claude)

Owner decision on D-127 (b): the request must not name the method. Prompt only; hidden tests, key and answers
unchanged; versions 3 to 4. Free gates after the change are unchanged (t12-parallel-backlog 100 / 0 / 20 / 100,
t12-sdlc-contact-import 100 / 0 / 36.4 / 100), and the scenarios lint is clean.

| Task | Date | What changed | Why |
| --- | --- | --- | --- |
| t12-parallel-backlog | 2026-11-20 | "Plan the work ... then carry the plan out", "do each package as its own separate piece of work" and "merge the packages one at a time" replaced by the outcome (every item that can ship merged by the freeze, the work split to run at the same time, each part reviewable before its merge) and the same delivered files (release plan block, work/P/ with REPORT.md, merge log in mergeOrder, tests green after every merge) | gpt-5.6-luna (s1) failed no-method-or-decoy: the request laid out the process |
| t12-sdlc-contact-import | 2026-11-20 | "from request to done, the way you would before handing it to review: pin down the requirements, decide the design, build it, test it" replaced by "Customers need the contact import ..., ready to hand to review"; the API, files and feature-note block are unchanged | the same finding |

## Non-Claude recheck, round 2 (D-108, D-127, 2026-11-20, mate hand-edit recheck worker)

These rows replace the round 1 rows above for the same tasks.

| Task | Recheck | Result | Note |
| --- | --- | --- | --- |
| t12-parallel-backlog | gpt-5.6-luna (c17, full) | confirmed after fix | gpt-5.6-luna found the login-only key match unfair (fixed, hidden test) and then the process named in the request (prompt rewritten to the outcome, owner decision); gpt-5.6-luna (c17) passes all four; verdicts in HAND-EDITS.md (no author review to hold them) |
| t12-sdlc-contact-import | gpt-5.6-luna (c17, full) | confirmed after fix | gpt-5.6-luna found the blank-line rule unfair (fixed, hidden test) and then the process named in the request (prompt rewritten to the outcome, owner decision); gpt-5.6-luna (c17) passes all four; verdicts in HAND-EDITS.md (no author review to hold them) |

## Answer-key reconcile (2026-11-20, key-reconcile worker)

Who: claude (kirocrew-mate-worker, key-reconcile session), applying the reconciled Fable and Opus 5.5 answer-key passes
(reports/key-improve/reconciled.md in the mate workspace). `t12-sop-route-choice` is kept as it is (owner ruling).

- `t12-spec-rate-limits` (version 3): `block-kit/key.json`: `limit-per-key-not-ip` is no longer a gate (one missing
  negation word zeroed the task: "Unlike the 2025 proposal to throttle by client IP..." failed it); it is a weight-2
  item whose `none` list also takes unlike, replaces, old, previous, former, earlier, 2025, no longer, retired.
  `over-limit-429` reads 429, Retry-After and rate_limited over the whole requirements list, so a spec that splits them
  into three requirements passes. expertKey: 8 single-point items (adds store-down as its own item and one more open
  question: header scope, whether rejected requests count, unknown plan, Retry-After rounding or clock skew).
  `adjudication` added. New `answers/.../other`: the reference with the "Unlike the 2025 proposal" wording, the 429
  rule split in three, fail closed and other open questions. Free gates: reference 100, stub 0, lazy 0, alt 100,
  shallow 0, other 100.
  - After the gpt-5.6-luna recheck (key-matches-fixture fail: the hidden `maxLen` caps of 14 requirements, 14 tasks and
    8 open questions were never stated): the request now states those caps; after the second gpt-5.6-luna recheck (unstated minimums of 5 requirements and 3 tasks) it states the full bounds: 5 to 14 requirements, 3 to 14 tasks, 1 to 8 open questions. Gates unchanged.
  - Third gpt-5.6-luna recheck: fails fixture-lists-no-answer, key-matches-fixture and solvable-from-fixture.
    Fixed: `store-failure-task` now reads the whole block (a store-down choice in an open question or a requirement
    counts, not only in a task), because the folder never asks for it. Disputed, not changed: the product request
    listing the rules is the input a spec task works from, and burst and the window type are left open on purpose
    (the request asks for open questions). `pilot.decision` is fix with a blocker until a fourth non-Claude recheck.
    Gates unchanged: reference 100, stub 0, lazy 0, alt 100, shallow 0, other 100.
  - Fourth recheck (owner-approved, deepseek-3.2, given the owner's rulings on the two disputed points: the product
    request is the spec task's input, and unsettled points are meant for openQuestions): 4 of 4 recheck items and 5 of
    5 review checks pass. `review` now holds this recheck; `pilot.decision` keep, blocker cleared.

## Wave 11/12 fixes (2026-11-21, mate wave 11/12 fix worker, claude)

No model call. Pilot wave 12 scored a complete, well-traced vanilla spec 25.

| Task | Date | What changed | Why |
| --- | --- | --- | --- |
| t12-spec-rate-limits v4 | 2026-11-21 | key only: `starter-figure` and `studio-figure` also accept a requirement for "each/every/all/any plan" with the figure from `config/plans.json`; `test-task` also accepts Retry-After, "refus" or `rate_limited` as the over-limit behaviour; `remaining-header-task` also accepts a task naming the remaining count ("remaining") | The wave 12 answer states one rule for each plan's `requestsPerMinute` read from `config/plans.json` (correct, and what the folder wants: figures are not copied), a task of limiter unit tests covering Retry-After, and a task that computes the remaining count, and failed all three items for not repeating the plan name, "429" or the header name. Gates after: reference 100, stub 0, lazy 0, alt 100, other 100, shallow 0; the wave 12 answer passes every item. |

Easy by design (no change to tests). Pilot wave 12 scored these 91 to 100; in the dry run the lazy answer stays low, so
a lazy answer does not pass. Their ceiling notes are in the task review where the task has one; these two have no
author review, so the note is here:

- `t12-parallel-backlog`: vanilla 100, lazy 20, shallow 0, stub 0. A plain planning and merge job a careful developer finishes.
- `t12-sdlc-contact-import`: vanilla 91, lazy 36.4, shallow 0, stub 0. A plain importer job a careful developer finishes.

## Review fixes of the wave 11/12 edits (2026-11-21, mate wave 11/12 review-fix worker, claude)

From `reports/review-wave11-12-edits-claude-opus-5.5.md` and `reports/review-wave11-12-edits-claude-fable-5.1.md`.
No model call. Probe answers scored with the bench's own check code.

| Task | Date | What changed | Why |
| --- | --- | --- | --- |
| t12-spec-rate-limits v5 | 2026-11-21 | key: `starter-figure` / `studio-figure` became `named-plan-figure` (a requirement names starter or studio with its figure source) and `every-plan-figure` (the same, or a rule for each/every/all/any plan or plans); `test-task` no longer takes "refus"; `remaining-header-task` keeps "remaining" but not "remaining tasks/work/items/instance/edge cases/..."; new shallow fake `answers/.../shallow-paste` (the request pasted in as requirements, three generic tasks) gated at 40 by the batch config | v4 let a pasted request finish the requirements section (50), missed "all plans", passed "the remaining instance" and "Refuse requests whose key is unknown" plus a test file. Now: paste 25, a rule for every plan with no plan named 75 (one item), "all plans" 75, the wave 12 answer and the reference 100. |
| t12-spec-rate-limits v5 | 2026-11-21 | key: `limit-per-key-not-ip` hides a per-IP phrase only when a negation or contrast word (not, never, no longer, instead of, rather than, unlike, replaced, superseded, old, previous, former, earlier, 2025) sits up to 6 words before it, or retired/dropped/replaced/superseded/removed/no longer up to 6 words after | The old `none` list held `\bnot\b`, `old` and `2025` and was applied to the whole requirement, so "limits each caller per client IP; a key is not tracked" passed the item (Opus F5). Now that answer fails it; "requests are not limited per client IP" and "limiting per client IP is superseded" still pass. |

## Round 6 recheck fix (2026-11-21, mate recheck worker, claude)

The round 6 gpt-5.6-luna recheck (L2) failed `t12-handoff-export-dates` on no-method-or-decoy: the request laid out the
second step as a process ("as a second, separate piece of work: whoever does it starts with nothing but the hand-off,
reads only ..."). Under the owner rule for the other two T12 tasks (D-127 b), the request now states the outcome: the
fix is finished, it needed nothing but the hand-off and its context.files, it changed only those files and left the
hand-off as written, and `docs/handoff/BILL-1187-result.md` records that with the same fields. The pull request line
now says the owner opens it. Prompt only; hidden tests, checks, key and answers unchanged, so the free gates are
unchanged (100 / 0 / 27.3 / 100). Version 2 to 3. One writer-family fix; a gpt-5.6-luna recheck follows.

## No hand-kept fixture copy in the delegation work tests (2026-11-21, mate debt worker, DEBT D-120)

`t12-handoff-export-dates` (v4) and `t12-parallel-backlog` (v5) replayed the agent's work against `.bench-base/`, a
copy of the fixture's code kept in sync by hand, and each carried its own copy of three process helpers. Now each
`.bench-lib.json` maps `.bench-base` to `@pristine`, so the `tests` check copies the untouched fixture in at run time
(replacing anything the agent left at that path), and maps `work-kit.js` (`files`, `node`, `withTemp`) from
`bench/scenarios/lib/hidden`. The two `.bench-base/` dirs are deleted. No assertion changed. Free gates after:
references 100, stubs 0, lazy 27.3 and 20, alternatives 100, shallow 0 (the same as before). Each needs a non-Claude
recheck at its new version before a lock.

## Round 6 recheck of t12-handoff-export-dates v4 (2026-11-21, gpt-5.6-luna, call L14)

3 of 4 pass, so nothing is recorded in `review.recheck`. Listed for independent review (Fable), not disposed.
fixture-lists-no-answer: `docs/notes/sam-diagnosis.md:5-6` gives the cause and says the UTC getters fix it, and
`test/export.test.js:12-15` shows the UTC outputs. The task is a half-done fix to hand off, so this may be its input.
t12-parallel-backlog v5 (L15) passes 4 of 4 and is recorded.

Independent review (claude-fable-5.1, `reports/review-probe-disposals-fable.md` in the mate workspace): the L14 fail
is by design, since Sam's notes are the half-done work the hand-off must absorb. The L14 recheck is now in
`review.recheck` at version 4, with that disposal in its note.

## t12-sdlc-contact-import v5 (2026-11-22, mate LITE-fix worker, claude; LITE analysis item 7)

The prompt offered "committing the work on the branch I am on is fine", but the fixture has no git repository; all
six LITE runs ended saying they could not commit. It now says the folder is not a git repository and the work stays
as files; the scope confirmation is kept. No check, key or fixture changed; gates unchanged (reference 100, stub 0,
lazy 36.4, alt 100, shallow 0). Non-Claude recheck: pending (`handEdited.version` 5).

## t12-delegated-worker-fix v2 (2026-11-22, mate LITE-fix worker 2, owner-assigned fixer gpt-terra; LITE analysis item 12)

The only criterion (`worker-briefs-and-review`) reads the git history, which the judge bundle does not hold (`.git` is
skipped and the saved workspaces have none), so its verdict was a coin toss per judge. Added three criteria that
the judge can read from the final text and the tool calls: `work-handed-to-workers` (weight 2), `review-reported`
(weight 1) and `cleanup-reported-truthfully` (weight 1). The old criterion stays; a bundle that carries the merge log
(analysis fix 10) would make it readable, and is another fixer's change. No prompt, check, key or fixture change; gates
stand. A score for the new criteria needs a re-judge (paid, not run). Non-Claude recheck: pending (`handEdited.version` 2).
