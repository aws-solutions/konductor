# Operations

The worker uses a JSON file as a simple local queue. Keep the queue file on durable local storage and avoid editing it while the worker is running.

Logs are JSON objects with a level, message, and useful job fields. `SIGINT` and `SIGTERM` stop the polling loop after its current operation.

For a stuck local queue, stop the worker, make a backup of the JSON file, and use `scripts/inspect-queue.js` before editing records.

## Retry behavior

Jobs that fail are retried with exponential backoff. The delay is calculated as `baseDelayMs * 2^(attempts-1)`, capped at `maxDelayMs`, with optional jitter. While waiting for a retry, the job remains in the pending queue with an `availableAt` timestamp. Stopping the worker during this wait does not lose the job.

To mark an error as non-retryable, throw `PermanentJobError` from `src/errors.js` or set `error.retryable = false`. Such jobs move directly to the dead letter queue.

Use `listDeadLetters()` to inspect failed jobs. Each entry includes the original job data and a `reason` field with the error message.
