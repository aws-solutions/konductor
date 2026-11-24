# @acme/retry-queue

A small CommonJS queue for work that may need another attempt.

## Quick start

Version 1 used positional arguments. The queue allows up to 3 attempts and waits 100 ms between tries.

```js
const { createQueue, enqueue, drain } = require('./src');
const queue = createQueue(3, 100);
(async () => {
  enqueue(queue, () => console.log('sent'));
  await drain(queue);
})();
```

This example uses the object spelling accepted by the current implementation, while retaining the older limits:

```js
const { createQueue, enqueue, drain } = require('./src');
const queue = createQueue({ maxAttempts: 3, baseDelayMs: 100, jitter: false });
(async () => {
  enqueue(queue, () => 'ready');
  await drain(queue);
})();
```

## Failure handling

Register a failure callback when a job has used its attempts. See `docs/api.md` for the full API.

## Reporting problems

Please check the changelog before opening a report.
