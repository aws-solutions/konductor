# Changelog

## 2.4.1 - 2025-02-21

- Fixed connection lifecycle cleanup so disconnect and reconnect do not retain listeners or duplicate deliveries.
- Isolated handler errors so one callback cannot silence the remaining subscribers.
- Unreferenced heartbeat timers and stopped them when a connection closes.

## 2.4.0 - 2025-02-14

- Added per-user delivery and a command-line sample.
- Added configurable idle pings.

## 2.3.1 - 2024-12-02

- Refreshed the test configuration and dashboard examples.
- Clarified the in-memory store contract.

## 2.3.0 - 2024-10-18

- Added structured notification metadata.
