# Changelog

## 2.4.2 - 2025-01-15

- Fixed POST body being lost on retry attempts.
- Fixed timeout timer not being cleared after response completion.
- Fixed retry delay not respecting Retry-After header from server.

## 2.4.1 - 2025-01-14

- Clarified the cache option in the README.
- Kept request logging fields stable for service dashboards.

## 2.4.0 - 2024-11-03

- Added the response cache for idempotent reads.
- Added support for Unix-style service URLs in local development.
