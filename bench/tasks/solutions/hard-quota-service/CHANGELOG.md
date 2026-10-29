# Changelog

## Unreleased

- Add `createQuotaService`: per-plan minute, day and month quotas with atomic charging and idempotent request ids.
- Fix `windowStart` and `windowEnd`: day and month windows are now UTC calendar windows (they used local time), and month ends are correct in leap years.
- Fix `resolvePlan`: a plan no longer inherits limits from a plan resolved earlier.
- Fix `config/plans.json`: the pro monthly limit is 100000.

## 0.4.0

- Plans are read from `config/plans.json`.
- `secondsUntil` never returns less than 1.

## 0.3.0

- `createLimiter` accepts a custom `store`.
