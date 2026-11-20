# Changelog

## 2.4.2 - 2025-01-15

### Fixed
- POST request body is now correctly preserved across retry attempts.
- Timeout timer is now properly cleared after response completion.
- Retry delay now correctly honors the `Retry-After` response header (both numeric seconds and HTTP-date formats).
- Attempts counter now correctly counts actual network attempts.

### Changed
- Retry logic now uses configured `sleep` callback for delay between retries.
- Timeout errors now consistently use `ETIMEDOUT` error code.

## 2.4.1 - 2025-01-14

- Clarified the cache option in the README.
- Kept request logging fields stable for service dashboards.

## 2.4.0 - 2024-11-03

- Added the response cache for idempotent reads.
- Added support for Unix-style service URLs in local development.
