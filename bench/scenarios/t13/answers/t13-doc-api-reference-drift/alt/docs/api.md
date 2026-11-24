# API reference

This is the version 2 API for `@acme/retry-queue`. The examples use CommonJS `require` and can be run from the package root. The queue is owned by its caller; `drain` resolves after pending work has settled.

## Compatibility and support

The colleague confirmed that the package supports Node 18 and 20. Node 16 was dropped in 2.0, so use Node 18 or newer. The colleague also confirmed that bugs go to the GitHub issues page, not email.

The JSON block below records the API inventory. `functions` is a list of objects with a function `name`, its `signature`, a `defaults` object whose option values are numbers or booleans, and a `status` of `current`, `deprecated`, or `removed-from-docs`. `examplesChecked` is the number of fenced JavaScript examples in this README and API document. `notes` is a list of short strings: what was wrong before, and what the maintainer confirmed because the repository does not say it.

```json
{
 "notes": [
  "The colleague confirmed that bugs go to the GitHub issues page, not email.",
  "The colleague confirmed retryNow goes away in 3.0. No date is set, so users should use drain.",
  "The colleague confirmed support for Node 18 and 20. Node 16 was dropped in 2.0, so this guide says Node 18 or newer.",
  "The old reference used positional construction, claimed 3 attempts and a 100 ms delay, and documented flush; version 2 uses an options object, 5 attempts, 200 ms, and drain."
 ],
 "examplesChecked": 4,
 "functions": [
  {
   "status": "removed-from-docs",
   "defaults": {},
   "signature": "flush(queue)",
   "name": "flush"
  },
  {
   "status": "deprecated",
   "defaults": {},
   "signature": "retryNow(queue)",
   "name": "retryNow"
  },
  {
   "status": "current",
   "defaults": {},
   "signature": "resume(queue)",
   "name": "resume"
  },
  {
   "status": "current",
   "defaults": {},
   "signature": "pause(queue)",
   "name": "pause"
  },
  {
   "status": "current",
   "defaults": {},
   "signature": "onFailure(queue, fn)",
   "name": "onFailure"
  },
  {
   "status": "current",
   "defaults": {},
   "signature": "drain(queue)",
   "name": "drain"
  },
  {
   "status": "current",
   "defaults": {},
   "signature": "enqueue(queue, job, opts = {})",
   "name": "enqueue"
  },
  {
   "status": "current",
   "defaults": {
    "concurrency": 4,
    "jitter": true,
    "baseDelayMs": 200,
    "maxAttempts": 5
   },
   "signature": "createQueue(opts = {})",
   "name": "createQueue"
  }
 ]
}
```

## Deprecated and removed APIs

### retryNow

Runs the same drain operation, but is deprecated.

**Signature:** `retryNow(queue)`

Use `drain(queue)` instead. The colleague confirmed that `retryNow` will be removed in 3.0; no date is set.

### flush (removed from the documentation)

The old `flush(queue)` function was removed in 2.0.

**Signature:** `flush(queue)`

Replace it with `drain(queue)`.

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

A per-job attempt limit and failure observer can be combined:

```js
const { createQueue, enqueue, drain, onFailure } = require('./src');
const queue = createQueue({ baseDelayMs: 0, jitter: false });
let failures = 0;
onFailure(queue, () => { failures += 1; });

(async () => {
  const result = enqueue(queue, () => { throw new Error('permanent'); }, { attempts: 1 });
  await result.catch(() => undefined);
  await drain(queue);
  console.log(`failed jobs: ${failures}`);
})();
```

## Current functions

### createQueue

Creates a retry queue from an options object.

**Signature:** `createQueue(opts = {})`

Options and defaults:

| Option | Type | Default | Unit or meaning |
| --- | --- | --- | --- |
| `maxAttempts` | number | `5` | attempts per job |
| `baseDelayMs` | number | `200` | milliseconds before the first retry |
| `jitter` | boolean | `true` | vary retry delays when enabled |
| `concurrency` | number | `4` | jobs running at once |

### enqueue

Adds a value or function job to a queue.

**Signature:** `enqueue(queue, job, opts = {})`

The optional `attempts` value overrides `maxAttempts` for one job. The optional `delayMs` value overrides the queue's base delay. The returned promise resolves with the job result and rejects after the configured attempt limit.

### drain

Waits for all queued work to settle and returns the queue's failure records.

**Signature:** `drain(queue)`

### onFailure

Registers a callback for jobs that exhaust their attempts.

**Signature:** `onFailure(queue, fn)`

The callback receives the original error and a record containing the job id and attempt count. The returned function unregisters the callback.

### pause

Stops starting pending jobs while allowing active jobs to finish.

**Signature:** `pause(queue)`

### resume

Allows pending jobs to start again.

**Signature:** `resume(queue)`
