# Ring-aware receipt PDF rollout

## Risks and dependencies

A stale or unit-mismatched snapshot can produce false confidence, so the evaluator reports HOLD for missing, unknown, or incomplete data. A freeze can make a healthy result operationally unusable, so the plan treats a freeze as a separate gate. The legacy envelope is a dependency of another team; the PDF release must not delete that generator. A queued request can otherwise skip an intermediate state, so all state-changing calls share one queue and return a copy of the committed entry.

The record accepts both the current array form and the older object-shaped stored form. New writes keep a history entry and an updated UTC timestamp, which gives the operator a reversible audit trail without requiring a database migration.

```json
{
  "evidence": [
    "docs/architecture.md:7",
    "docs/partners.md:3",
    "ops/budget-policy.json:8",
    "ops/freeze-calendar.csv:3",
    "docs/error-budget-policy.md:3",
    "ops/budget-policy.json:3",
    "ops/freeze-calendar.csv:2",
    "ops/rings.json:2"
  ],
  "risks": [
    {
      "mitigation": "In short: Expose an explicit library rollback that records the lower percentage and rollback status.",
      "risk": "A rollback only at the caller can leave shared state advanced."
    },
    {
      "mitigation": "In short: Retain the old path and coordinate removal only after 2025-09-30.",
      "risk": "Ledger Lantern still reads the old envelope until 2025-09-30; do not remove the legacy generator before then."
    },
    {
      "mitigation": "In short: Check the calendar in the promotion library and report a named frozen outcome.",
      "risk": "An active freeze may be bypassed by a healthy metric result."
    },
    {
      "mitigation": "In short: Keep the queue in the shared rollout library and commit each state transition there.",
      "risk": "Two operators can race and publish an out-of-order percentage."
    },
    {
      "mitigation": "In short: Normalize only known suffixes, validate against the catalogue, require contiguous complete minutes, and HOLD on uncertainty.",
      "risk": "A missing observation or an unrecognized metric header makes a snapshot look healthier than it is."
    }
  ],
  "decisions": [
    {
      "reason": "In short: The audiences have different exposure and error-budget tolerance.",
      "choice": "Apply each ring's own policy: staff 15 minutes at 1.0 percent, pilot 30 at 1.5, regional 60 at 2.0, and general 120 at 2.5, rather than one global budget.",
      "topic": "limits"
    },
    {
      "reason": "In short: A low average is not evidence when the sample is incomplete or ambiguous.",
      "choice": "Map RECEIPT_ERROR_RATE_PERCENT and other documented aliases to receipt_error_rate, refuse metrics outside the catalogue, and answer HOLD when a minute is missing or fewer than ten complete minutes exist.",
      "topic": "measurement"
    },
    {
      "reason": "In short: A scheduled operational freeze needs a deterministic, auditable exception boundary.",
      "choice": "Treat regional's 2025-12-20T00:00:00Z through 2026-01-03T23:59:59Z calendar window as a hard promotion stop using an injected UTC clock, while allowing emergency rollback.",
      "topic": "freeze"
    },
    {
      "reason": "In short: Concurrent operators must not skip a committed step or silently undo it.",
      "choice": "Promotions run one at a time through a mutex in the library; a backward move is refused unless the caller uses the explicit rollback.",
      "topic": "state transition"
    },
    {
      "reason": "In short: The new PDF is additive and must not break a remaining stored-format consumer.",
      "choice": "Do not remove the legacy generator before Ledger Lantern finishes its migration on 2025-09-30; roll back from the highest enabled ring downward.",
      "topic": "compatibility"
    },
    {
      "reason": "In short: The deployment audience and its dependency order are part of the operational contract.",
      "choice": "Follow the order field in config: staff, then pilot, then regional, then general. Names are never sorted.",
      "topic": "sequence"
    },
    {
      "reason": "In short: Promotion needs one accountable approver while safety action must remain available to the operator.",
      "choice": "The release owner promotes; the service on-call can halt or roll back, and the release channel records the snapshot and decision.",
      "topic": "authority"
    }
  ]
}
```

## Decisions

The ring sequence comes from `ops/rings.json`, including its explicit order. The library never sorts names and never allows a later ring to move while the preceding ring is below 100 percent. Percentages come from the configured `percentages` map, so an operator cannot invent an unreviewed step.

`promote` is serialized inside the library. That matters because two operators can read the same state and request adjacent steps at once. A promotion is accepted only when the requested step is greater than the stored percentage, is configured, and has a complete predecessor. A lower value is an error unless the caller invokes the explicit rollback operation.

A freeze window is a hard stop for promotion. The clock is injected so the decision is testable and deployment tooling can evaluate the same UTC instant. A freeze does not rewrite state and does not prevent an emergency rollback. The program manager records the reason and announces a delayed window rather than asking an operator to bypass it.

The go/no-go result uses the ring's own metric window and limits. It normalizes metric header case and the supported percent or millisecond suffixes, but still requires the normalized name to exist in the catalogue. Ten complete one-minute observations are required. Any missing minute is HOLD, a value below the promotion limit is PROMOTE, and a value at or above the rollback limit is ROLLBACK.

Only the release owner may request PROMOTE, while the service on-call may halt expansion or invoke rollback immediately. The release owner posts the decision and snapshot location in the release channel; the partner owners receive the decision before the next audience is enabled. Rollback proceeds from the highest enabled ring down to the affected ring, then the old generator remains available until its consumer migration is complete.

## Purpose

The PDF generator needs a controlled path from internal users to every merchant. The rollout state is a small coordination record, not a second source of truth for receipt data. The go/no-go command evaluates an exported snapshot, while the library owns ordering and state transitions.
