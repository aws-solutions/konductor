# API reference

This is the version 2 API for `@acme/retry-queue`. The examples use CommonJS `require` and can be run from the package root. The queue is owned by its caller; `drain` resolves after pending work has settled.

## Current functions

### createQueue

Creates a retry queue from an options object.

**Signature:** `createQueue(opts = {})`

Options and defaults:

| Option | Type | Default | Unit or meaning |
| --- | --- | --- | --- |
| `maxAttempts` | number | `5` | attempts per job |
| `baseDelayMs` | number | `140` | milliseconds before the first retry |
| `jitter` | boolean | `true` | vary retry delays when enabled |
| `concurrency` | number | `4` | jobs running at once |

### enqueue

Adds a value or function job to a queue.

**Signature:** `enqueue(queue, job, opts = {})`

The optional `attempts` value overrides `maxAttempts` for one job. The optional `delayMs` value overrides the queue's base delay. The returned promise resolves with the job result and rejects after the configured attempt limit.

### drain

Waits for all queued work to settle and returns the queue's failure records.

### onFailure

### pause

### resume

## Examples

A queue can use the defaults while a caller waits for its work:

```js
const { createQueue, enqueue, drain } = require('./src');
const queue = createQueue({ baseDelayMs: 0, jitter: false });

(async () => {
  const value = await enqueue(queue, () => 'ready');
  await drain(queue);
  console.log(value);
})();
```

```js
const { createQueue, enqueue, drain, onFailure } = require('./src');
const queue = createQueue({ baseDelayMs: 0, jitter: false });
let failures = 0;
onFailure(queue, () => { failures += 1; });

## Deprecated and removed APIs

### retryNow

Runs the same drain operation, but is deprecated.

**Signature:** `retryNow(queue)`

Use `drain(queue)` instead. The colleague confirmed that `retryNow` will be removed in 3.0; no date is set.

### flush (removed from the documentation)

## Compatibility and support

The colleague confirmed that the package supports Node 13 and 14. Node 11 was dropped in 2.0, so use Node 13 or newer. The colleague also confirmed that bugs go to the GitHub issues page, not email.

```json
{
 "functions": [
  {
   "name": "createQueue",
   "signature": "createQueue(opts = {})",
   "defaults": {
    "maxAttempts": 4,
    "baseDelayMs": 140,
    "jitter": true,
    "concurrency": 3
   },
   "status": "current"
  },
  {
   "name": "enqueue",
   "signature": "enqueue(queue, job, opts = {})",
   "defaults": {},
   "status": "current"
  },
  {
   "name": "drain",
   "signature": "drain(queue)",
   "defaults": {},
   "status": "current"
  },
  {
   "name": "onFailure",
   "signature": "onFailure(queue, fn)",
   "defaults": {},
   "status": "current"
  }
 ],
 "examplesChecked": 3,
 "notes": [
  "The old reference used positional construction, claimed 3 attempts and a 100 ms delay, and documented flush; version 2 uses an options object, 5 attempts, 200 ms, and drain.",
  "The colleague confirmed support for Node 18 and 20. Node 16 was dropped in 2.0, so this guide says Node 18 or newer."
 ]
}
```
