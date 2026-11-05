# Test plan: order cancellation and refunds

Source: `docs/feature-spec.md`.

## Scope

Cancellation rules, authorization, refund amount, the approval threshold and refund idempotence.

## Out of scope

Refunds to store credit, the audit log of refunds and partial refunds are out of scope for this release.

## Test data

- Order P: status `placed`, owner c1, shipping 5, one item at 19.99 times 3.
- Order K: status `packed`, same items.
- Order S: status `shipped`.
- Users: owner c1, other customer c2, support user u9.

## Cases

| ID | Area | Case | Expected |
|----|------|------|----------|
| C1 | Cancel | Owner cancels order P | Status is `cancelled` |
| C2 | Cancel | Owner cancels order K | Status is `cancelled` |
| C3 | Cancel | Owner cancels order S (shipped) | Rejected: order cannot be cancelled |
| C4 | Cancel | A delivered order is cancelled | Rejected: order cannot be cancelled |
| C5 | Auth | Support user cancels order P | Allowed |
| C6 | Auth | Customer c2 cancels order P | Rejected: not allowed |
| C7 | Auth | Customer c2 requests a refund for a cancelled order | Rejected: not allowed |
| C8 | Amount | Refund of an order cancelled while placed | Items plus shipping: 64.97 |
| C9 | Amount | Refund of an order cancelled while packed | Items only: 59.97, shipping not refunded |
| C10 | Approval | Refund of 499.99 | State `issued` |
| C11 | Approval | Refund of exactly 500.00 | State `issued` |
| C12 | Approval | Refund of 500.01 | State `pending-approval` |
| C13 | Once | Second refund request for the same order | Returns the first refund, creates nothing new |
| C14 | Once | Two requests in quick succession | One refund exists |
| C15 | State | Refund requested for an order that is not cancelled | Rejected: order is not cancelled |

## Exit criteria

All cases pass; each rejection returns the exact message from the spec.
