# Configuration

The JSON files in `config/` are read at startup. `worker.json` contains worker behavior and `limits.json` contains payload and timing limits. Keys use lower camel case and durations use milliseconds unless their name ends in `Seconds`.

For local operation, environment variables are applied after the files are merged. The supported names are `WORKER_POLL_INTERVAL_MS`, `WORKER_MAX_ATTEMPTS`, `WORKER_LEASE_SECONDS`, `WORKER_LOG_LEVEL`, `WORKER_QUEUE_NAME`, `WORKER_REGION`, `WORKER_CONCURRENCY`, `WORKER_MAX_PAYLOAD_BYTES`, `WORKER_JOB_TIMEOUT_MS`, and `WORKER_BACKOFF_MS`. An unset variable leaves the file value in place; an explicitly supplied value wins.

A file value is parsed as JSON and validated before the process starts. Operators should change one setting at a time and retain the previous files until the next deploy has passed its probes. Values are not fetched from a remote store.
