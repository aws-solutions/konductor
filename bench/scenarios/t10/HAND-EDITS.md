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
