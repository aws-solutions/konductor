# quota-kit

Small helpers for limiting how often a caller may do something.

## Legacy limiter

```js
const { createLimiter } = require('./src');

const limiter = createLimiter({ limit: 5, windowSec: 60 });
limiter.check('user-1'); // { allowed: true, remaining: 4, resetAt: 1700000040000 }
```

`createLimiter` is a single fixed-window counter. It is used by several services and its behavior
must not change.

## Time windows

Windows are calendar windows in UTC, so a "day" starts at 00:00 UTC whatever the server's time zone.
`src/window.js` has the helpers (`windowStart`, `windowEnd`, `secondsUntil`).

## Quota service

```js
const { createQuotaService } = require('./src');

const quota = createQuotaService();
quota.consume('user-1', { plan: 'free', cost: 2, requestId: 'req-9' });
// { allowed: true, remaining: { minute: 8, day: 198, month: 2998 }, limitedBy: null, retryAfterSec: null }
```

Minute, day and month limits per plan are checked together; a denied request charges nothing.
See `docs/QUOTA-SPEC.md`.

## Plans

`config/plans.json` lists the request limits per plan. A window without a number is unlimited.
`src/plans.js` resolves a plan name to its limits.

## Layout

- `src/index.js` public exports
- `src/limiter.js` legacy limiter
- `src/window.js`, `src/store.js`, `src/keys.js`, `src/clock.js` helpers
- `src/quota.js` multi-window quota service
- `docs/QUOTA-SPEC.md` spec of the quota service
