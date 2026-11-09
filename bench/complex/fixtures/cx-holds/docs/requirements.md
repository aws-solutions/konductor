# Stock holds: requirements

Checkout needs to set units aside while a customer pays. Today the only choice is to take stock out
for good, which strands units when a customer walks away.

## Behaviour

A hold sets aside `qty` units of one SKU for a limited time.

- Creating a hold takes `sku`, `qty` and an optional `ttlSec` (default 300).
  `qty` is a positive integer. `ttlSec` is an integer from 1 to 900.
  A hold has an `id`, its `sku` and `qty`, a `status` and an `expiresAt` (epoch milliseconds,
  creation time plus `ttlSec` seconds).
- A hold is `active`, `confirmed`, `released` or `expired`. New holds are `active`.
- Units held are no longer available to anyone else. Two buyers racing for the last unit
  must never both get it, and stock must never go negative or be handed back twice.
- Confirming an active hold sells the units for good (`confirmed`). Confirming a confirmed
  hold again returns the same result. A confirmed hold never expires.
- Releasing an active hold returns its units (`released`). Releasing twice returns the units once.
  A confirmed hold cannot be released.
- A hold expires when the clock reaches `expiresAt` (at that instant, not after it). Its units
  return to stock. Nothing has to run in the background: an expired hold is accounted for the
  next time its SKU is looked at, held or reported. Confirming an expired hold fails and the units are back in stock.
  Releasing an expired hold is not an error; the result shows `expired`.
- Availability is units that are neither held nor sold.

## Errors

| code | status | when |
|---|---|---|
| `invalid_request` | 400 | missing or malformed `sku`, `qty` or `ttlSec`, or a body that is not JSON |
| `unknown_sku` | 404 | the SKU is not stocked |
| `hold_not_found` | 404 | no hold with that id |
| `insufficient_stock` | 409 | fewer units available than `qty` |
| `hold_released` | 409 | confirming a released hold |
| `hold_confirmed` | 409 | releasing a confirmed hold |
| `hold_expired` | 410 | confirming an expired hold |

## Interface

- `createHoldService({ stock, clock })`, exported from `src/index.js`, with asynchronous
  `hold(sku, qty, ttlSec)`, `confirm(id)`, `release(id)` and `available(sku)`.
  Each hold call returns the hold as `{ id, sku, qty, status, expiresAt }`.
- The existing `createServer({ stock, clock })` also serves
  `POST /holds`, `POST /holds/:id/confirm` and `DELETE /holds/:id`.
  Creating a hold answers 201; the others answer 200 with the hold.
  `GET /stock/:sku` reports availability as defined above.
