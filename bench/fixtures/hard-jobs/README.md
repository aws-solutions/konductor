# ledger-batch

Applies a batch of payment events through a handler and totals the amounts per customer.

```js
const { runBatch, createDedupeStore } = require('./src');

const dedupe = createDedupeStore();
const result = await runBatch(events, { handle: sendToLedger, dedupe });
// { totals: { c1: 1250 }, processed: 3, duplicates: 1, failed: [{ id: 'e9', attempts: 4, message: 'timeout' }] }
```

An event is `{ id, customerId, amountCents, ts }`. Amounts are integers in cents and may be negative.

## Behavior

This section is the contract.

- `handle(event)` is an async function. If it throws, the failure is treated as transient.
- Each event is attempted at most `1 + maxRetries` times. Before retry number `k` (k = 1, 2, ...) the
  batch waits `retryDelayMs * 2^(k-1)` milliseconds by calling `options.sleep(ms)`.
- At most `concurrency` handlers are in flight at once.
- Totals only include events whose handler succeeded, and only from the current call: every call to
  `runBatch` starts from empty totals.
- Duplicates: an event is a duplicate when its id was handled successfully before and is still
  remembered by the dedupe store, or when an earlier event (in input order) in the same batch has the
  same id. A duplicate is never handled and is counted in `duplicates`, even if the earlier event
  with that id fails for good.
- A dedupe store remembers an id for `ttlMs` after it was handled. At exactly `ttlMs` the id is
  forgotten. Only successful events are remembered, so an event that failed for good is handled again
  when it is sent in a later batch.
- Without `options.dedupe`, each call uses a fresh store (no memory across calls).
- `failed` lists the events that ran out of attempts, in input order, as `{ id, attempts, message }`
  where `message` is the error's message (or `String(error)` for a non-Error value).
- `concurrency` must be an integer >= 1, otherwise `RangeError`.

## Defaults

| option          | default            |
|-----------------|--------------------|
| `concurrency`   | 4                  |
| `maxRetries`    | 3                  |
| `retryDelayMs`  | 200                |
| `ttlMs` (dedupe)| 3600000 (one hour) |

Defaults live in `config/default.json`. Options passed to one call never affect later calls.

## Layout

- `src/batch.js` `runBatch`
- `src/pool.js` runs work with a concurrency limit
- `src/retry.js` retry with exponential backoff
- `src/dedupe.js` dedupe store
- `src/aggregate.js` per-customer totals
- `docs/OPERATIONS.md` incident notes
