# Changelog

## 2.5.0

- Added per-job-type retry policies with exponential backoff, jitter, and max delay cap.
- Added `PermanentJobError` class for non-retryable failures.
- Jobs with `retryable === false` on errors no longer retry.
- Added optional `shouldRetry(error, job)` hook for custom retry logic.
- Retries are persisted with `availableAt` to prevent job loss on shutdown.
- Added `listDeadLetters()` and `nextAvailableAt()` to JobQueue.
- Injected clock and random functions for deterministic testing.

## 2.4.0

- Added shipment and inventory job handlers.
- Improved queue inspection output.

## 2.3.0

- Added structured worker logs.
