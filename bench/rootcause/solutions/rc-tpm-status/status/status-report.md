# Checkout redesign: status report, 2025-03-14

## Overall status: RED (last week: GREEN)

The 2025-04-15 launch will be missed by two to three weeks unless executives act. Payment gateway integration (W3) was due on 2025-02-28 and is 35 percent complete. It sits on the critical path: the security review (W7) starts only after W3 ends and needs 10 working days, then launch readiness (W9) follows. At the pace in the weekly sync, W3 ends around 2025-04-11 and the review around 2025-04-25. Last week's report said green and "on track" because the tracker still shows W3 as On track after its due date passed.

## Progress against plan

Overall progress is 55 percent (effort weighted). Done: design system update (W1). Nearly done: cart service refactor (W2, 90 percent, due 2025-03-07, a week late). Behind: W3 (35 percent, due 2025-02-28), staging environment W4 (40 percent, due today, still missing the payment sandbox connection). Not started: security review, launch readiness, customer communications.

## Data issue to resolve

The tracker marks the load test (W5) as Done at 100 percent, but it depends on W3 (35 percent) and W4 (40 percent), neither of which is finished. The load test result cannot be valid. Treat W5 as not done until it is rerun against staging with the real payment path. Owner: Omar.

## Budget

936,000 of the 1,200,000 budget is spent (78 percent) at 55 percent progress. At that burn rate the estimate at completion is about 1.70 million, roughly 500,000 or 42 percent over budget. Another 90,000 is committed in open purchase orders. Last week's "budget on plan" no longer holds.

## Decision needed from executives by 2025-03-21

Choose one:

1. Move the launch to about 2025-05-06 (three weeks). Keeps scope, adds the overrun above. Lowest delivery risk.
2. Keep 2025-04-15 and descope the loyalty points UI (W6, 20 percent) to a later release and add a second engineer on the gateway code (Chen has capacity). Reduces cost pressure but does not remove the W7 wait; the launch date holds only if W3 ends by 2025-03-28, which the current pace does not support.
3. Launch on 2025-04-15 without the full security review. Not recommended.

Recommendation: option 1, with the loyalty points UI reviewed for descoping to protect budget.

## Milestones

| Milestone | Planned | Forecast | State |
|-----------|---------|----------|-------|
| Payment gateway integration (W3) | 2025-02-28 | about 2025-04-11 | Red |
| Security review (W7) | 2025-03-28 | about 2025-04-25 | Red |
| Launch | 2025-04-15 | about 2025-05-06 | Red |

## Top risks

1. Critical-path slip on W3 and W7 puts the launch date at risk (new, high).
2. Priya owns W2, W3, W9 and W11 and is the only engineer who knows the gateway code (new, high).
3. The payment provider sandbox was unavailable for three working days (new, medium).
4. Budget overrun of about 42 percent (new, high).
5. Staging environment capacity and the missing sandbox connection (R3, now has an owner).

The full register is in `status/risk-register.md`.
