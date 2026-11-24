# API reference

This reference describes the version 1 interface. Every function is listed with its old spelling.

## createQueue

Creates a queue with a maximum number of attempts and a delay in milliseconds.

```js
const { createQueue, enqueue, flush } = require('../src');
const queue = createQueue(3, 100);
enqueue(queue, () => 'done');
flush(queue);
```

Signature: `createQueue(maxAttempts, delay)`

The old defaults are 3 attempts and 100 ms. Jobs may be functions or values.

## enqueue

Adds a job. The optional `attempts` value limits retries for the job.

## flush

Flushes all queued jobs and returns a promise.

```js
const { createQueue, enqueue } = require('../src');
const queue = createQueue({ maxAttempts: 3, delay: 100 });
enqueue(queue, () => console.log('done'));
queue.flush();
```

## onFailure

Registers a callback after a job has failed.
