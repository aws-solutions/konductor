# edge-gateway

A small in-process gateway. It normalizes a raw request, routes it to a handler and turns the result
(or the error) into a response object. There is no network code in this package.

```js
const { createGateway, manualClock } = require('./src');

const gateway = createGateway({
  handlers: { 'GET /echo': (req) => ({ said: req.query.text }) },
  clock: manualClock(0),
});
gateway.handle({ method: 'GET', path: '/echo', query: { text: 'hi' }, user: 'ana', ip: '10.0.0.1' });
// { status: 200, body: { said: 'hi' } }
```

## Requests

`handle(raw)` accepts `{ method, path, query, headers, user, ip }`. Missing fields are filled in by
`src/request.js`. `user` is the authenticated user id (or absent), `ip` the caller address.

## Responses

- `{ status: 200, body }` for a handler result
- `{ status, body: { error } }` for an `HttpError` thrown by a handler (and 404 for an unknown route)
- `{ status: 500, body: { error: 'internal error' } }` for any other exception

## Clock

The gateway reads time through `clock.now()` (epoch milliseconds). Tests use `manualClock`.

## Layout

- `src/gateway.js` the gateway
- `src/router.js` route matching (`'METHOD /path/:param'`)
- `src/request.js` request normalization
- `src/response.js` response helpers
- `src/handlers/` sample handlers
