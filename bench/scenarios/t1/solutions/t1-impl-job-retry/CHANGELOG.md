# Changelog

## 2.5.0

- Added per-job-type retry policies with exponential backoff, caps, jitter, and retry hooks.
- Persisted attempts and retry availability in queue records.
- Added dead-letter records for permanent and exhausted failures.

## 2.4.0

- Added shipment and inventory job handlers.
- Improved queue inspection output.

## 2.3.0

- Added structured worker logs.
