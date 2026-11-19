# Operations

The worker uses a JSON file as a simple local queue. Keep the queue file on durable local storage and avoid editing it while the worker is running.

Each job type can have a `retryPolicies` entry passed to `WorkerRunner`. `maxAttempts` counts the initial execution. A failed attempt is stored with its incremented `attempts` count before a retry is queued. Delays use exponential backoff from `baseDelayMs`, are capped by `maxDelayMs`, and can use a fractional `jitter` value. The `shouldRetry(error, job)` hook can reject an otherwise retryable error.

Permanent failures, including `PermanentJobError` and errors with `retryable === false`, are never retried. Exhausted or rejected jobs move to `deadLetter` with the original error message as `reason`. A retry is written back to the queue with `availableAt` before the worker waits, so stopping during the wait does not lose the job.

Logs are JSON objects with a level, message, and useful job fields. `SIGINT` and `SIGTERM` stop the polling loop after its current operation.
