# Feature spec: order cancellation and refunds

Status: approved for the next release.

## Rules

1. An order can be cancelled only while its status is `placed` or `packed`. A `shipped` or `delivered` order cannot be cancelled; the request is rejected with "order cannot be cancelled".
2. Only the customer who owns the order, or a user with the `support` role, can cancel it or request its refund. Anyone else is rejected with "not allowed".
3. The refund amount is the sum of price times quantity over the items. If the order was cancelled while `placed`, the shipping charge is refunded too. If it was cancelled while `packed`, shipping is not refunded.
4. A refund over 500.00 is not issued at once. It is created in state `pending-approval` and waits for a manager. A refund of 500.00 or less is created in state `issued`.
5. Each order has at most one refund. A second request for the same order returns the first refund unchanged and creates nothing new.
6. A refund can be requested only for a cancelled order; otherwise the request is rejected with "order is not cancelled".

## Out of scope for this release

- Refunds to store credit.
- The audit log of refunds.
- Partial refunds.

## Data

An order has `id`, `customerId`, `status`, `shipping` and a list of `items`, each with `price` and `qty`. Prices are in the shop currency with two decimals.
