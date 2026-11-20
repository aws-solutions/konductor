# Changelog

## 1.4.1 - 2025-02-12

- Fixed cache entry TTL not refreshing when overwriting existing entries.
- Corrected weight tracking when replacing cached entries.
- Sweep now removes expired entries directly without affecting hit/miss stats.

## 1.4.0 - 2025-02-11

- Added permission lookup support beside profile lookup.
- Added a bounded in-memory cache for repeated account reads.
- Documented local development and health reporting.

## 1.3.2 - 2024-11-03

- Corrected the CLI exit status for malformed input.
- Kept the data store usable without a database connection.

