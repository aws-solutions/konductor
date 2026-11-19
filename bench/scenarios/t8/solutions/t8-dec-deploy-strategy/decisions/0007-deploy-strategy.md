# Decision 0007: production deployment strategy

**Status:** Accepted  
**Owner:** Platform SRE  
**Date:** 2025-08-21  
**Scope:** RelayRoom's edge gateway, session router, presence workers, and collaboration API

## Decision

Use a **canary deployment** as the standard production release path. The canary is a small, explicit exposure set, not a second permanent fleet. Start with four hosts (10%), hold for eight minutes while checking the release signals, then expand by zone only after the hold is clean. Keep the previous binary available on unreleased hosts and keep draining established websocket sessions rather than terminating them.

This choice gives the on-call engineer an early stop point for the failure mode seen in RR-221. At 14:32 UTC on 2025-08-19, a session-router setting changed the per-host upstream pool from 240 to 120. Pool wait rose to 418 ms, assignments failed, and reconnect retries followed. The database was not the initiating fault: its commit latency was 38 ms and CPU was 54% in the same window. The exposure stopped at 14:34 UTC, the setting was restored at 14:37 UTC, and pool wait was back to 72 ms at 14:40 UTC.

## Options considered

### Rolling update, rejected

A rolling update is simple and supports two application versions during an additive database migration. It does not create the cost problem of a duplicate fleet. However, a broad rolling sequence can expose every host before the 12-minute containment window closes and gives less useful early separation for a session-router pool or retry problem. The first exposure should remain small and observable. Evidence: `logs/session-router.log:340-345`.

### Blue/green, rejected

Blue/green would make binary switching straightforward, but it requires another 40-host serving fleet. That exceeds the 3.2 host-equivalent planning headroom and the $2,800 monthly safety budget. The estimated $7,200 monthly second fleet is not approved. Long websocket drains also mean the old environment cannot disappear immediately. Evidence: `docs/capacity-report.md:7-13`, `docs/finance-note.md:3-5`, and `docs/slo.md:5`.

### Canary, chosen

A four-host, 10% canary fits the available slice and gives a measurable stop point before the remaining zones are exposed. It can check websocket connect errors, room-operation errors, upstream pool wait, presence lag, and host CPU. The canary must use a schema-compatible application version because the shared database has to serve two application versions during the overlap. Evidence: `config/service.yaml:8-16`, `logs/session-router.log:342-345`, and `docs/schema-compatibility.md:3`.

## Constraints and operating rules

- Keep the existing websocket drain behavior. The p95 drain is 40 minutes, so a clean rollout must not equate a long-lived session with a stuck release.
- Treat the shared database as a two-version boundary. Use additive schema changes first and postpone destructive changes until the old binary is gone.
- Keep incremental release-safety spend below $2,800 USD per month. Do not reserve a second serving fleet.
- Preserve a path to the goal of 3 production deploys per week. The canary steps and hold time must be automated in the ordinary runbook rather than becoming an emergency-only ritual.
- Stop exposure or revert within 12 minutes after a failed release health signal. Record the UTC signal time and the containment action.
- The 40-host, 72% normal-utilisation baseline leaves 3.2 host-equivalents at the 80% planning ceiling; use it when selecting exposure sizes.

## Signals and rollback

Page or stop the canary for websocket connection errors above the configured threshold, room-operation errors, upstream pool wait above 250 ms, presence lag above 30 seconds, or host CPU above 80% for its alert window. Stop assigning new sessions to the canary, preserve the event time, and restore the last known-good binary or setting. Continue the drain for established sessions. If the canary remains healthy through the hold, expand one zone at a time and keep the same checks.

## Revisit triggers

Revisit this decision when normal fleet CPU utilisation reaches 78%, when spare capacity at the 80% planning ceiling falls below two host-equivalents, when the p95 websocket drain changes materially from 40 minutes, or when the approved release-safety budget changes from $2,800 USD. Revisit sooner if the delivery goal cannot stay at 3 deploys per week or the 12-minute containment requirement changes.

```json
{
  "decision": "canary",
  "options": [
    {
      "name": "rolling",
      "verdict": "rejected",
      "reasons": [
        "A broad rolling sequence can expose the whole fleet before the 12-minute containment window closes and gives less early separation for the session-router pool retry failure; keep the first exposure small and observable. Evidence: logs/session-router.log:340-345."
      ]
    },
    {
      "name": "blue/green",
      "verdict": "rejected",
      "reasons": [
        "Blue/green needs a full second 40-host serving fleet, about $7,200 USD per month, above the $2,800 USD safety cap and beyond the 11.2 host-equivalent headroom. Evidence: docs/capacity-report.md:7-13 and docs/finance-note.md:3-5."
      ]
    },
    {
      "name": "canary",
      "verdict": "chosen",
      "reasons": [
        "A four-host 10% canary with an eight-minute hold creates an early stop point before zone expansion and fits the available slice.",
        "At 2025-08-19T14:32:10Z, the initiating failure was an upstream connection pool reduction from 240 to 120 followed by pool wait and reconnect retries, not database latency. Evidence: logs/session-router.log:340-344 and logs/collab-api.log:341."
      ]
    }
  ],
  "constraints": [
    {
      "id": "CAPACITY-72",
      "text": "The 40-host fleet runs at 72% normal CPU utilisation, leaving 3.2 host-equivalents at the 80% planning ceiling.",
      "source": "docs/capacity-report.md"
    },
    {
      "id": "SOCKET-DRAIN-40",
      "text": "The p95 websocket drain time is 40 minutes, so established sessions must remain connected during host replacement.",
      "source": "docs/slo.md"
    },
    {
      "id": "SCHEMA-2V",
      "text": "Shared database schema changes must support two application versions at once during a release.",
      "source": "docs/schema-compatibility.md"
    },
    {
      "id": "COST-2800",
      "text": "Approved incremental release-safety spend is capped at $2,800 USD per month; a second 40-host fleet is estimated at $7,200 USD per month.",
      "source": "docs/finance-note.md"
    },
    {
      "id": "FREQUENCY-3",
      "text": "The platform delivery goal is 3 production deploys per week while keeping the connection SLO green.",
      "source": "docs/deploy-goals.md"
    },
    {
      "id": "REVERT-12",
      "text": "A failed production release must be stopped or reverted within 12 minutes of its release health signal.",
      "source": "docs/compliance-note.md"
    }
  ],
  "revisitWhen": [
    "Revisit when normal fleet CPU utilisation reaches 78% or spare capacity at the 80% planning ceiling falls below two host-equivalents; see docs/capacity-report.md.",
    "Revisit when the p95 websocket drain changes materially from 40 minutes; see docs/slo.md.",
    "Revisit when the approved release-safety budget changes from $2,800 USD or the delivery goal cannot remain 3 deploys per week; see docs/finance-note.md and docs/deploy-goals.md."
  ]
}
```
