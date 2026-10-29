# Data exports

Both files are overwritten by a nightly job. Amounts are integer cents.

## data/orders.json

Export of the shop database. One object per order: `id`, `customer`, `createdAt` (ISO 8601, UTC),
`status` (`paid`, `pending`, `cancelled`, `refunded`) and `amountCents` (what the customer was charged).
Orders are created when the customer checks out, so a cancelled order is still listed.

## data/ledger.csv

Export of the accounting ledger kept by finance. Header: `id,postedAt,orderId,type,amountCents,status`.
`type` is `sale`, `refund` (negative amount) or `fee` (payment processing fee, negative amount).
`status` is `posted` once finance has booked the row and `pending` before that. `postedAt` is ISO 8601, UTC.
