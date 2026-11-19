# Fulfilment worker

This small Node.js worker drains a file-backed queue of order fulfilment jobs. It handles inventory synchronisation and shipment creation jobs.

## Running

The project targets Node.js 24 and has no runtime dependencies. Run `node --test` for the checks or `npm start` to run the worker with `config/default.json`.

## Queue records

Jobs contain an `id`, a `type`, a `payload`, and an `attempts` counter. Queue files have `pending` and `deadLetter` arrays. Failed jobs follow the `retryPolicies` entry for their type. A policy's `maxAttempts` includes the first attempt, and exhausted jobs retain the error message in the dead-letter record.

The runner accepts an injected `clock` with `now()` and `sleep(milliseconds, signal)` and a `random()` function so backoff can be tested without waiting. `baseDelayMs`, `maxDelayMs`, and `jitter` control exponential retry delays. `PermanentJobError` and errors with `retryable === false` always go directly to dead letter.

Operational notes are in `docs/operations.md`; supported job payloads are in `docs/jobs.md`.
