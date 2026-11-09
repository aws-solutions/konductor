# stockd

A small in-memory stock service. It keeps unit counts per SKU and reports availability over HTTP.

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

## Layout

- `src/stock.js`: the stock store. Calls are asynchronous and each `adjust` is applied atomically.
- `src/clock.js`: `systemClock`, an object with `now()` returning epoch milliseconds. Tests pass their own.
- `src/http.js`: a minimal JSON router on `node:http`.
- `src/server.js`: the routes.

Run the tests with `npm test`.
