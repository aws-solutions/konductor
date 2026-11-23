# T10 hand edits

Every change to a task's prompt, fixture, key, checks or rubric by anyone other than its recorded author (owner rule, 2026-11-19). The table lists the kept tasks; none so far.

| task | who | what | why |
| --- | --- | --- | --- |

## Dropped

| task | who | what | why |
| --- | --- | --- | --- |
| t10-dev-quiet-hours-digest | claude, kirocrew-mate-worker (T10 worker session) | `task-draft.json`: the two document `tests` check commands named `block.test.cjs`; removed the author's `hidden/block.test.cjs.template` and its wrong `block-kit/package.json` | the author's one fix round wrote shell commands inside the checks; task then DROPPED: lazy answer 54.8 |

## Answer-key reconcile (2026-11-20, key-reconcile worker)

Who: claude (kirocrew-mate-worker, key-reconcile session), applying the reconciled Fable and Opus 5.5 answer-key passes
(reports/key-improve/reconciled.md in the mate workspace).

- `t10-arch-outbox` (version 2): the request now names what the hidden behaviour tests read: the `statusEvents`
  collection, the event fields (`id` prefixed `evt_`, `orderId`, `status`, `occurredAt`, `attempts`, `nextAttemptAt`,
  `claimedBy`, `claimedUntil`, `sentAt`, `deadLetter`, `lastError`), the message `status` and `headers['x-event-id']`,
  and the result's `outcomes` list. `block-kit/key.json`: `atomic-transition` drops its `none` list ("not a separate
  later publish" failed it); `design-evidence` needs 4 of the 5 source groups (was 5 of 5). `rollout-kit/key.json`:
  `disabled-before-enable` takes ENABLED=false, off or dark beside "disabled", and "turn on" beside "enable".
  expertKey: 9 single-point items (duplicate window, stale write-back over whole-collection writes, claim longer than
  the publish timeout, poison order, permanent oversize errors, dead-letter operations, cut-over, settings changes,
  owner and window). Rubric `design-matches-code` added. New `answers/.../other` (the alt code with design and rollout
  blocks that use the negated and flag wording and cite four groups). Free gates: reference 100, stub 3.6, lazy 34,
  alt 100, other 100.
- `t10-tpm-ring-rollout` (version 2): the request says `initialState` may be the `state()` object or the older stored
  shape `{rings: {<name>: {percentage, status}}}` (three hidden tests use the older shape). Fixture
  `docs/error-budget-policy.md` line 5 says the window is a look-back and ten complete minutes inside it are enough (a
  staff snapshot of 11 minutes must PROMOTE). The CHANGELOG `cmd` check reads the Unreleased section for "ring",
  PROMOTE|HOLD|ROLLBACK and legacy|old generator|Ledger Lantern (was three exact phrases). `block-kit/key.json`:
  `serialized-state`, `gap-hold` and `ring-budgets` each become one fact read over the whole decisions list
  (`serialized-state` no longer needs "25 percent", the agent's own step choice); `declared-order`, `freeze-stop` and
  `rollout-kit` `phase-metrics-catalogued`, `freeze-action`, `rollback-descends` drop their `none` lists; `legacy-risk`
  and `rollback-preserves-old` fail only "remove it now/immediately". expertKey: 8 items (adds serialised promotions;
  the history-vs-small-state item had no fixture anchor and is gone). Rubric `plan-follows-policy` added. New
  `answers/.../other`. Free gates: reference 100, stub 5.7, lazy 28.8, alt 100, other 100.

## t10-arch-outbox v3 (2026-11-21, mate debt worker, DEBT D-119)

The fixture's `npm test` and CI line ran `node --test test/`, which fails on Node 22 and later (Node reads the
directory as one file), so an untouched fixture looked broken. Both now run `node --test test/*.test.js`, as the
reference and answers already did. Free gates unchanged: reference 100, stub 3.6, lazy 34, alt 100, other 100.
Non-Claude recheck: pending (`handEdited.version` 3).

## t10-tpm-ring-rollout v3 (2026-11-22, mate LITE-fix worker, claude; LITE analysis item 9)

The LITE analysis said vanilla r3 loosened an existing test. Read against the workspace, it loosened its own new
test (`test/rollout-docs.test.js`, written in the same run); no run changed the fixture's 8 test files. The guard was
still missing: only `docs/partners.md` is checked unchanged, so a run could weaken an existing test in `test/` and
its regression check would pass. New hidden test 19, "the original test suite passes unchanged", runs copies of the
fixture's 37 tests (`hidden/.../pristine-tests/`) against the final code. A separate `tests` check was tried first and
dropped: it lifted the stub to 38.8. Gates: reference 100, stub 5.7, lazy 28.5, alt 100, other 100. Saved LITE
answers: vanilla r1 72.4, r3 56.2 (close to their run scores). Non-Claude recheck: pending (`handEdited.version` 3).

## Round 6 recheck of t10-tpm-ring-rollout v3 (2026-11-22, deepseek-3.2, call D19)

3 of 4 pass, so nothing is recorded in `review.recheck`. Listed for independent review (Fable), not disposed.
no-method-or-decoy: the request names exact files (`src/ring-rollout.js`, `src/go-no-go.js`,
`scripts/receipt-go-no-go.js`), function signatures, exports, error codes and JSON block formats. That may be the
interface the hidden tests load, which earlier reviews passed as an entry point, not a method.

Independent review (claude-fable-5.1, `reports/review-probe-disposals-fable.md` in the mate workspace): the D19 fail
is by design, because the request names the interface the hidden tests import. The D19 recheck is now in
`review.recheck` at version 3, with that disposal in its note.

## t10-tpm-ring-rollout v4 (2026-11-22, mate LITE-fix worker, claude; LITE fix 9), logged 2026-11-23

Commit 53cc33ad added eight `fixture_unchanged` checks, one per file in the fixture's `test/`, and bumped the task to
v4 (the id took the `-v4` suffix in f8431fc0). The edit was not logged here and `handEdited.version` stayed 3. The
STANDARD gate worker set `handEdited.version` to 4 and wrote this entry on 2026-11-23. The checks are the only
content change since the v3 recheck. Non-Claude recheck of v4: pending.
