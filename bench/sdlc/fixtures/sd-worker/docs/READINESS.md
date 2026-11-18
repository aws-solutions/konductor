# Production readiness checklist: invoice worker

The worker takes jobs from a queue and calls `handler(job, { apiKey })`, which sends one invoice through the billing
provider. It goes to production next month. These items must hold first.

## Interface

`createWorker({ queue, handler, env, log, clock })` returns `{ start, stop, health, getMetrics }`.

- `env` defaults to `process.env`; `log(entry)` defaults to writing `JSON.stringify(entry)` to stdout; `clock` has
  `now()` in epoch milliseconds and defaults to `Date`.
- `ConfigError` is exported from `src/index.js`.

## 1. Configuration

| variable | rule | default |
|---|---|---|
| `WORKER_API_KEY` | required, not empty | none |
| `WORKER_CONCURRENCY` | integer from 1 to 16 | 2 |
| `WORKER_DRAIN_MS` | integer from 0 to 60000 | 5000 |

All three are read once, in `createWorker`. A missing or out-of-range value throws a `ConfigError` whose message
names the variable. The worker never starts with a value it did not check.

## 2. Secrets

No key in the source. The handler gets the key from `WORKER_API_KEY`. No log entry may hold the key.

## 3. Logs

Each finished job logs one entry: `{ level: 'info', msg: 'job done', jobId }`, or on failure
`{ level: 'error', msg: 'job failed', jobId, error }` where `error` is the error message. A handler that throws at
once counts as a failure like one that rejects, and the worker keeps going.

## 4. Metrics and health

- `getMetrics()` returns `{ processed, failed, inFlight }`: jobs that succeeded, jobs that failed, jobs running now.
- `health()` returns `{ ok, inFlight, lastSuccessAt }`. `ok` is true between `start()` and `stop()`.
  `lastSuccessAt` is `clock.now()` at the last success, or null.

## 5. Shutdown

`stop()` returns a promise of `{ drained }`. It takes no new job from the queue (jobs not yet taken stay there),
waits for the jobs in flight for at most `WORKER_DRAIN_MS`, and resolves with `drained: true` if they all finished,
else `drained: false`.

## 6. Runbook

Write `docs/RUNBOOK.md`: the alarms (metric, threshold, period, first action), and the monthly cost of the billing
calls. Volume: 3,000,000 jobs a month, one billing call per job, 0.20 USD per 1,000 calls.
