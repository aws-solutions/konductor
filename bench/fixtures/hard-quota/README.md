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

Windows are aligned to the server's local time, so a "day" starts at local midnight.
`src/window.js` has the helpers (`windowStart`, `windowEnd`, `secondsUntil`).

## Plans

`config/plans.json` lists the request limits per plan. A window without a number is unlimited.
`src/plans.js` resolves a plan name to its limits.

## Layout

- `src/index.js` public exports
- `src/limiter.js` legacy limiter
- `src/window.js`, `src/store.js`, `src/keys.js`, `src/clock.js` helpers
- `docs/QUOTA-SPEC.md` spec of the multi-window quota service (not built yet)
