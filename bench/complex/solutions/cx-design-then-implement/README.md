# stockd

A small in-memory stock service. It keeps unit counts per SKU, reports availability over HTTP and lets checkout hold units for a short time.

## Use

```js
const { createStock, createServer, systemClock } = require('./src');

const stock = createStock({ widget: 5, gadget: 2 });
createServer({ stock, clock: systemClock }).listen(3000);
```

```
GET /stock/widget   ->  200 {"sku":"widget","available":5}
GET /stock/nothing  ->  404 {"error":{"code":"unknown_sku","message":"unknown sku: nothing"}}
```

Errors always have the shape `{"error":{"code","message"}}`. Services throw `ServiceError`, which carries `code` and an HTTP `status`.

## Holds

A hold sets units aside while a customer pays. See `docs/design.md` for the design.

```
POST   /holds               {"sku":"widget","qty":2,"ttlSec":300}  ->  201 hold
POST   /holds/:id/confirm                                         ->  200 hold
DELETE /holds/:id                                                 ->  200 hold
```

A hold is `{ id, sku, qty, status, expiresAt }`. Status is `active`, `confirmed`, `released` or `expired`.
`GET /stock/:sku` counts expired holds as available again.

## Layout

- `src/stock.js`: the stock store. Calls are asynchronous and each `adjust` is applied atomically.
- `src/holds.js`: the hold service.
- `src/clock.js`: `systemClock`, an object with `now()` returning epoch milliseconds. Tests pass their own.
- `src/http.js`: a minimal JSON router on `node:http`.
- `src/server.js`: the routes.

Run the tests with `npm test`.
