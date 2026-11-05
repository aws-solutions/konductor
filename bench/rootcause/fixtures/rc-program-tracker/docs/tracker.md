# Checkout redesign: tracker (as of 2025-03-14)

Launch target: 2025-04-15. Overall progress (effort weighted): 55 percent.

| ID | Item | Owner | Start | Due | Done % | Status | Depends on |
|----|------|-------|-------|-----|--------|--------|------------|
| W1 | Design system update | Lena | 2025-01-20 | 2025-02-14 | 100 | Done | none |
| W2 | Cart service refactor | Priya | 2025-02-03 | 2025-03-07 | 90 | On track | W1 |
| W3 | Payment gateway integration | Priya | 2025-02-10 | 2025-02-28 | 35 | On track | W2 |
| W4 | Staging environment | Omar | 2025-02-17 | 2025-03-14 | 40 | At risk | none |
| W5 | Load test | Omar | 2025-03-03 | 2025-03-12 | 100 | Done | W3, W4 |
| W6 | Loyalty points UI | Chen | 2025-03-03 | 2025-04-04 | 20 | On track | W2 |
| W7 | Security review | Ana | 2025-03-17 | 2025-03-28 | 0 | Not started | W3 |
| W8 | Accessibility audit | Lena | 2025-03-10 | 2025-03-21 | 50 | On track | W1 |
| W9 | Launch readiness and rollout | Priya | 2025-04-07 | 2025-04-14 | 0 | Not started | W5, W7, W8 |
| W10 | Customer communications | Sam | 2025-03-24 | 2025-04-11 | 0 | Not started | none |
| W11 | Payment provider certification | Priya | 2025-03-10 | 2025-04-04 | 10 | On track | W3 |

## Notes from the weekly sync

- The payment provider sandbox was unavailable from 2025-03-10 to 2025-03-12. W3 and W11 lost three working days.
- W3 needs roughly 4 more weeks at the pace of the last month. The security review (W7) needs 10 working days after W3 ends and cannot start earlier.
- Staging (W4) is due today and is still missing the payment sandbox connection.
- Chen has capacity to take work. Priya is the only engineer who knows the gateway code.
