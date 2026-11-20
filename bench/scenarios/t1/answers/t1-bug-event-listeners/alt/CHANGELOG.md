# Changelog

## 2.4.1 - 2025-02-15

### Bug fixes
- Fixed memory leak where event listeners accumulated on reconnect (missing `bus.off()` in disconnect).
- Fixed duplicate notifications when a user reconnected without disconnecting.
- Fixed failing async callback blocking other subscribers and socket delivery.
- Fixed heartbeat timers keeping the event loop alive after close.

### Reliability
- Connection, disconnect, and close are now idempotent.
- One failed subscriber no longer prevents others from receiving notifications.

## 2.4.0 - 2025-02-14

- Added per-user delivery and a command-line sample.
- Added configurable idle pings.

## 2.3.1 - 2024-12-02

- Refreshed the test configuration and dashboard examples.
- Clarified the in-memory store contract.

## 2.3.0 - 2024-10-18

- Added structured notification metadata.
