# Ring-aware receipt PDF rollout

## Purpose

The PDF generator needs a controlled path from internal users to every merchant. The rollout state is a small coordination record, not a second source of truth for receipt data. The go/no-go command evaluates an exported snapshot, while the library owns ordering and state transitions.

## Decisions

The ring sequence comes from `ops/rings.json`, including its explicit order. The library never sorts names and never allows a later ring to move while the preceding ring is below 70 percent. Percentages come from the configured `percentages` map, so an operator cannot invent an unreviewed step.

`promote` is serialized inside the library. That matters because two operators can read the same state and request adjacent steps at once. A promotion is accepted only when the requested step is greater than the stored percentage, is configured, and has a complete predecessor. A lower value is an error unless the caller invokes the explicit rollback operation.

A freeze window is a hard stop for promotion. The clock is injected so the decision is testable and deployment tooling can evaluate the same UTC instant. A freeze does not rewrite state and does not prevent an emergency rollback. The program manager records the reason and announces a delayed window rather than asking an operator to bypass it.

## Risks and dependencies

A stale or unit-mismatched snapshot can produce false confidence, so the evaluator reports HOLD for missing, unknown, or incomplete data. A freeze can make a healthy result operationally unusable, so the plan treats a freeze as a separate gate. The legacy envelope is a dependency of another team; the PDF release must not delete that generator. A queued request can otherwise skip an intermediate state, so all state-changing calls share one queue and return a copy of the committed entry.

```json
{
 "decisions": [
  {
   "topic": "authority",
   "choice": "The release owner promotes; the service on-call can halt or roll back, and the release channel records the snapshot and decision.",
   "reason": "Promotion needs one accountable approver while safety action must remain available to the operator."
  },
  {
   "topic": "sequence",
   "choice": "Use the declared staff -> pilot -> regional -> general order and configured 0, 10, 25, 50, 100 steps; do not sort names.",
   "reason": "The deployment audience and its dependency order are part of the operational contract."
  },
  {
   "topic": "compatibility",
   "choice": "Keep the legacy generator through the Ledger Lantern migration ending 2025-09-30 and roll back from the highest enabled ring downward.",
   "reason": "The new PDF is additive and must not break a remaining stored-format consumer."
  },
  {
   "topic": "state transition",
   "choice": "Serialize promotions in one queue: staff must reach 100 before pilot, and reject a backward 25 percent request unless the caller uses explicit rollback.",
   "reason": "Concurrent operators must not skip a committed step or silently undo it."
  }
 ],
 "risks": [
  {
   "risk": "A missing observation or an unrecognized metric header makes a snapshot look healthier than it is.",
   "mitigation": "Normalize only known suffixes, validate against the catalogue, require contiguous complete minutes, and HOLD on uncertainty."
  },
  {
   "risk": "Two operators can race and publish an out-of-order percentage.",
   "mitigation": "Keep the queue in the shared rollout library and commit each state transition there."
  },
  {
   "risk": "An active freeze may be bypassed by a healthy metric result.",
   "mitigation": "Check the calendar in the promotion library and report a named frozen outcome."
  }
 ],
 "evidence": [
  "ops/rings.json:2",
  "ops/freeze-calendar.csv:2",
  "ops/budget-policy.json:3",
  "docs/error-budget-policy.md:3"
 ]
}
```
