# Changelog

## Unreleased

- Fix events with the same id being handled twice when workers ran at the same time; later events with an id seen earlier in the batch are duplicates.
- Fix dedupe entries never expiring: `has` now honors the TTL, and an id is forgotten at exactly `ttlMs`.
- Fix retries: an event gets `1 + maxRetries` attempts, not `maxRetries`.
- Fix totals leaking between `runBatch` calls through a shared object.
- Fix the default dedupe TTL, which was 3600 ms instead of one hour.

## 1.3.2

- Retry delays are injectable with `options.sleep`.

## 1.3.1

- `failed` entries carry the number of attempts.

## 1.3.0

- Add `createDedupeStore` and `options.dedupe`.
