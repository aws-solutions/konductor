# Ring-aware receipt PDF rollout

## Purpose

The PDF generator needs a controlled path from internal users to every merchant. The rollout state is a small coordination record, not a second source of truth for receipt data. The go/no-go command evaluates an exported snapshot, while the library owns ordering and state transitions.

## Decisions

The ring sequence comes from `ops/rings.json`, including its explicit order. The library never sorts names and never allows a later ring to move while the preceding ring is below 100 percent. Percentages come from the configured `percentages` map, so an operator cannot invent an unreviewed step.

`promote` is serialized inside the library. That matters because two operators can read the same state and request adjacent steps at once. A promotion is accepted only when the requested step is greater than the stored percentage, is configured, and has a complete predecessor. A lower value is an error unless the caller invokes the explicit rollback operation.

A freeze window is a hard stop for promotion. The clock is injected so the decision is testable and deployment tooling can evaluate the same UTC instant. A freeze does not rewrite state and does not prevent an emergency rollback. The program manager records the reason and announces a delayed window rather than asking an operator to bypass it.

The go/no-go result uses the ring's own metric window and limits. It normalizes metric header case and the supported percent or millisecond suffixes, but still requires the normalized name to exist in the catalogue. Ten complete one-minute observations are required. Any missing minute is HOLD, a value below the promotion limit is PROMOTE, and a value at or above the rollback limit is ROLLBACK.

Only the release owner may request PROMOTE, while the service on-call may halt expansion or invoke rollback immediately. The release owner posts the decision and snapshot location in the release channel; the partner owners receive the decision before the next audience is enabled. Rollback proceeds from the highest enabled ring down to the affected ring, then the old generator remains available until its consumer migration is complete.

## Risks and dependencies

A stale or unit-mismatched snapshot can produce false confidence, so the evaluator reports HOLD for missing, unknown, or incomplete data. A freeze can make a healthy result operationally unusable, so the plan treats a freeze as a separate gate. The legacy envelope is a dependency of another team; the PDF release must not delete that generator. A queued request can otherwise skip an intermediate state, so all state-changing calls share one queue and return a copy of the committed entry.

The record accepts both the current array form and the older object-shaped stored form. New writes keep a history entry and an updated UTC timestamp, which gives the operator a reversible audit trail without requiring a database migration.

```json
{
  "decisions": [
    { "topic": "authority", "choice": "The release owner promotes; the service on-call can halt or roll back, and the release channel records the snapshot and decision.", "reason": "Promotion needs one accountable approver while safety action must remain available to the operator." },
    { "topic": "sequence", "choice": "Use the declared staff -> pilot -> regional -> general order and configured 0, 10, 25, 50, 100 steps; do not sort names.", "reason": "The deployment audience and its dependency order are part of the operational contract." },
    { "topic": "compatibility", "choice": "Keep the legacy generator through the Ledger Lantern migration ending 2025-09-30 and roll back from the highest enabled ring downward.", "reason": "The new PDF is additive and must not break a remaining stored-format consumer." },
    { "topic": "state transition", "choice": "Serialize promotions in one queue: staff must reach 100 before pilot, and reject a backward 25 percent request unless the caller uses explicit rollback.", "reason": "Concurrent operators must not skip a committed step or silently undo it." },
    { "topic": "freeze", "choice": "Treat regional's 2025-12-20T00:00:00Z through 2026-01-03T23:59:59Z calendar window as a hard promotion stop using an injected UTC clock, while allowing emergency rollback.", "reason": "A scheduled operational freeze needs a deterministic, auditable exception boundary." },
    { "topic": "measurement", "choice": "Normalize RECEIPT_ERROR_RATE_PERCENT and receipt_error_rate_milliseconds, require the catalogue metric, require ten complete minutes, and return HOLD for pilot-gap.csv or any missing minute.", "reason": "A low average is not evidence when the sample is incomplete or ambiguous." },
    { "topic": "limits", "choice": "Apply each ring's own policy: staff 15 minutes at 1.0 percent, pilot 30 at 1.5, regional 60 at 2.0, and general 120 at 2.5, rather than one global budget.", "reason": "The audiences have different exposure and error-budget tolerance." }
  ],
  "risks": [
    { "risk": "A missing observation or an unrecognized metric header makes a snapshot look healthier than it is.", "mitigation": "Normalize only known suffixes, validate against the catalogue, require contiguous complete minutes, and HOLD on uncertainty." },
    { "risk": "Two operators can race and publish an out-of-order percentage.", "mitigation": "Keep the queue in the shared rollout library and commit each state transition there." },
    { "risk": "An active freeze may be bypassed by a healthy metric result.", "mitigation": "Check the calendar in the promotion library and report a named frozen outcome." },
    { "risk": "Removing the old generator breaks the Ledger Lantern reconciliation consumer before its 2025-09-30 migration.", "mitigation": "Retain the old path and coordinate removal only after 2025-09-30." },
    { "risk": "A rollback only at the caller can leave shared state advanced.", "mitigation": "Expose an explicit library rollback that records the lower percentage and rollback status." }
  ],
  "evidence": [
    "ops/rings.json:2",
    "ops/freeze-calendar.csv:2",
    "ops/budget-policy.json:3",
    "docs/error-budget-policy.md:3",
    "ops/freeze-calendar.csv:3",
    "ops/budget-policy.json:8",
    "docs/partners.md:3",
    "docs/architecture.md:7"
  ]
}
```
