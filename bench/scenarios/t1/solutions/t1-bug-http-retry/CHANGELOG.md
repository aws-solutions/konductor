# Changelog

## 2.4.2 - 2025-02-02

- Honor numeric Retry-After values in seconds before a transient retry.
- Count retries as additional attempts and replay request bodies safely.
- Stop completed requests from firing their timeout later.

## 2.4.1 - 2025-01-14

- Clarified the cache option in the README.
- Kept request logging fields stable for service dashboards.

## 2.4.0 - 2024-11-03

- Added the response cache for idempotent reads.
- Added support for Unix-style service URLs in local development.
