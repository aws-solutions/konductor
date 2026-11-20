# Fulfilment worker

This small Node.js worker drains a file-backed queue of order fulfilment jobs. It currently handles inventory synchronisation and shipment creation jobs.

## Running

The project targets Node.js 24 and has no runtime dependencies. Run `node --test` for the checks or `npm start` to run the worker with `config/default.json`.

## Queue records

Jobs contain an `id`, a `type`, a `payload`, an `attempts` counter, and an optional `availableAt` timestamp for delayed retries. Queue files have `pending` and `deadLetter` arrays. The queue inspection command prints pending records in a readable form.

## Retry policies

WorkerRunner accepts `retryPolicies` keyed by job type. Each policy has:
- `maxAttempts`: Maximum attempts including the first (default: 1)
- `baseDelayMs`: Base delay for exponential backoff (default: 1000)
- `maxDelayMs`: Cap for the delay (default: 30000)
- `jitter`: Random jitter to add (default: 0)
- `shouldRetry(error, job)`: Optional async hook to control retry behavior

Errors with `retryable === false` or `PermanentJobError` never retry. When retries are exhausted, jobs move to the dead letter queue with the error message in the `reason` field.

Operational notes are in `docs/operations.md`; supported job payloads are in `docs/jobs.md`.
