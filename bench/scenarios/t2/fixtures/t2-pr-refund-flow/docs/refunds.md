# Refunds

`POST /v1/orders/:orderId/refund` accepts an amount such as `12.50` and
returns a refund id. The route emits `refund.created` for the merchant after
the ledger entry is written. Full and partial refunds use the same endpoint.

The amount must not exceed the order's captured balance. A refund is recorded
as a positive `refund` entry with the order and merchant ids attached; balance
projections apply the account direction when they consume the entry.

For display values, currency conversion uses nearest-minor-unit rounding.
Merchant identity is supplied in `x-merchant-id`, as it is for captures.

## Request shape

The request body contains an `amount` decimal string. The order id comes from
the URL, and the merchant header identifies the account making the request.
The optional card object supplies provider context for the payment adapter.

```json
{
  "amount": "12.50",
  "card": { "fingerprint": "fp_test_123" },
  "customerEmail": "buyer@example.invalid"
}
```

## Response shape

A successful request returns status `201` and a refund record with its id,
order id, merchant id, amount in minor units, and `succeeded` status. The
merchant event contains the refund id, order id, and the same minor-unit
amount. Event consumers can use the refund id as their delivery key.

A missing order returns `404`. An order that is not captured returns `409`, as
does an amount larger than the captured balance. Invalid or non-positive input
returns `400`.

## Ledger and delivery

The ledger write is the source of truth for the refund. The merchant event is
queued after that write and is delivered by the normal event worker. A worker
may retry delivery, so event consumers should make their own side effects
safe to repeat.

The service keeps the route and ledger entry small so the durable adapter can
replace the memory store without changing the public response. Provider
references remain outside the ledger payload and belong to the payment
adapter's audit record. Support tooling can locate a refund by its public id.
The public id is stable for the lifetime of the refund record.
The order remains available for later reconciliation and support searches.
The event payload intentionally mirrors the ledger amount.
