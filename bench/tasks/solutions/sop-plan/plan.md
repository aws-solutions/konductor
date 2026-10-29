# Implementation plan: hold requests

Source: `docs/` (vision, requirements REQ-1 to REQ-9, stories US-1 to US-5, design overview, open questions). US-6 (weekly report) is out of scope for this feature and has no task here.

## Assumptions

- The reservation window is 5 days. REQ-3 says 7 days and REQ-6 says 5 days, which conflict. I picked 5 because REQ-6 is the rule that actually releases the copy; please confirm.
- A bounced email or a member without an address does not block the reservation. The hold is still reserved and staff see a "notification failed" flag.
- Two copies returned at the same moment are assigned by an atomic claim of the head of the queue (one transaction per return).
- The 50 requests per second target in REQ-9 is measured on writes (placing and cancelling holds), with a median under 300 ms.
- Cancelled and expired holds are kept for 90 days, then deleted. This is an open question in the notes and needs a decision.
- The team is 2 backend engineers, 1 QA engineer, and a part-time DevOps engineer.

## Success Criteria

1. A signed-in member can place a hold on a title with no available copy, and gets a clear message when a copy is available (US-1, REQ-1).
2. Holds on a title are served strictly in the order they were created in 100% of 1000 randomised queue tests (REQ-2).
3. When a copy is returned, the first member receives an email within 60 seconds and the copy is reserved for 5 days (REQ-3, REQ-8, US-3).
4. A member can cancel a hold at any time before pickup, and every member behind moves up one place (REQ-4, US-4).
5. A reserved copy not picked up after 5 days goes back on the shelf and the next member is notified (REQ-6).
6. A member cannot have more than 5 active holds; the sixth attempt gets a 409 response (REQ-7).
7. At 50 write requests per second the median response time stays under 300 ms (REQ-9).

## Task Breakdown

| ID | Task | Priority | Effort | Depends on | Role |
|----|------|----------|--------|------------|------|
| T1 | Settle open decisions (reservation window, retention, bounce handling) | High | 0.5 days | none | Product owner |
| T2 | Hold table, statuses and migration | High | 1 day | T1 | Backend engineer |
| T3 | HoldQueueStore: add, order, cancel, atomic claim of queue head | High | 3 days | T2 | Backend engineer |
| T4 | HoldService: place hold with the 5-hold limit, cancel | High | 2 days | T3 | Backend engineer |
| T5 | Handle the "copy returned" event and reserve for the next member | High | 2 days | T3 | Backend engineer |
| T6 | Notifier: ready email, bounce and missing-address handling | Medium | 2 days | T5 | Backend engineer |
| T7 | Expiry job for reservations not picked up | Medium | 1.5 days | T5 | Backend engineer |
| T8 | Member API: place, list with position, cancel | Medium | 2 days | T4 | Backend engineer |
| T9 | Staff API: view queue, remove with reason | Medium | 1.5 days | T4 | Backend engineer |
| T10 | Integration and concurrency tests | High | 3 days | T5, T8 | QA engineer |
| T11 | Load test for REQ-9 | Medium | 1.5 days | T8, T10 | QA engineer |
| T12 | Deployment, alerts, dashboards | Low | 1 day | T8 | DevOps engineer |
| T13 | API documentation and staff guide | Low | 1 day | T9 | Backend engineer |

## Dependencies and Parallel Work

- Critical path: T1, T2, T3, T5, T10, T11.
- T4 and T5 both depend on T3 only, so they can run in parallel.
- T6 and T7 can run in parallel once T5 is done.
- T8 and T9 can run in parallel once T4 is done.
- No task depends on a later task, so there is no cycle.

## Timeline

| Phase | Tasks | Duration |
|-------|-------|----------|
| 1. Foundations | T1, T2, T3 | 4.5 days |
| 2. Core behaviour | T4, T5, T6, T7 | 4 days (parallel) |
| 3. APIs | T8, T9 | 2 days (parallel) |
| 4. Verification | T10, T11, T12 | 4.5 days |
| 5. Documentation | T13 | 1 day |

Serial sum of effort: 22 days. With two backend engineers in parallel the elapsed time is about 16 days. Add a 20% buffer (3 days) for the open decisions and the concurrency work: plan for 19 days elapsed.

## Execution Plan

1. Foundations first: decisions, schema, queue store.
2. Core behaviour and APIs, with unit tests written alongside each task.
3. Verification phase: integration and concurrency tests, the load test, and a walkthrough with a librarian against a staging copy.
4. Documentation phase: API reference and the staff guide, finished before release.
5. Release behind a feature flag, then remove the flag after one week without incidents.
