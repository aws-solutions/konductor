# Changelog

## 2.4.2

- Fixed unbounded growth in delivery de-duplication store with capacity limit of 3 keys.
- Added 60-second expiry window for deduplication entries.
- Keys are now normalized by trimming whitespace and comparing case-insensitively.
- Added `stats()` method with `remembered`, `max`, `windowMs`, `evictions`, and `expirations`.
- Expirations and capacity evictions are tracked separately in stats.

## 2.4.1

- Clarified the delivery callback contract.
- Kept startup diagnostics quiet in normal operation.

## 2.4.0

- Added a health command for container probes.
- Improved malformed signature messages.
