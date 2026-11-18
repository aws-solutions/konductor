# Runbook: invoice worker

## Configuration

| variable | rule | default |
|---|---|---|
| `WORKER_API_KEY` | required; from the secret store, never in the source | none |
| `WORKER_CONCURRENCY` | integer from 1 to 16 | 2 |
| `WORKER_DRAIN_MS` | integer from 0 to 60000 | 5000 |

A missing or out-of-range value stops the start with a `ConfigError` naming the variable.

## Alarms

| alarm | metric | threshold | period | first action |
|---|---|---|---|---|
| failures high | `failed` / (`processed` + `failed`) | above 5% | 5 minutes | read the `job failed` log entries for the provider error; if the provider is down, pause the queue |
| worker down | `health().ok` | false on every host | 2 checks, 1 minute apart | restart the worker; check the start log for a `ConfigError` |
| stuck jobs | `inFlight` with `processed` flat | `inFlight` equal to `WORKER_CONCURRENCY` and no success | 10 minutes | look at `lastSuccessAt`; restart one host and watch whether `processed` moves |
| unclean shutdowns | `stop()` result `drained: false` | more than 1 a day | 1 day | raise `WORKER_DRAIN_MS` or find the slow handler call |

## Cost

3,000,000 jobs a month, one billing call each, at 0.20 USD per 1,000 calls:
3,000,000 / 1,000 x 0.20 USD = 600 USD a month. The billing calls are the biggest cost; retries add one call each.

## Shutdown

Send the stop signal; the worker takes no new job and waits up to `WORKER_DRAIN_MS` for jobs in flight. Jobs not
taken stay in the queue for the next worker.
