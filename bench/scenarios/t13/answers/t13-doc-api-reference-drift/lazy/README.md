# @acme/retry-queue

A small CommonJS queue for work that may need another attempt.

## Compatibility

Version 2 accepts an options object. The defaults are `maxAttempts: 5`, `baseDelayMs: 140`, `jitter: true`, and `concurrency: 4`. The package supports Node 13 and 14, and Node 11 was dropped in 2.0, so use Node 13 or newer.

## Quick start

```js
const { createQueue, enqueue, drain } = require('./src');
const queue = createQueue({ baseDelayMs: 0, jitter: false });

(async () => {
  const result = await enqueue(queue, () => 'sent');
  await drain(queue);
  console.log(result);
})();
```

Pause a queue before adding work when a caller needs to hold it:

```js
const { createQueue, enqueue, drain, pause, resume } = require('./src');
const queue = createQueue({ baseDelayMs: 0, jitter: false });

## Reporting problems

Report bugs on the GitHub issues page, not by email. Include a small reproduction, the Node version, and the package version.
