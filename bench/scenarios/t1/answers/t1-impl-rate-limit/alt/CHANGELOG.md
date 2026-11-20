# Changelog

## 1.5.0 - 2025-02-15

- Added per-API-key request limiting for booking routes with configurable plans and quotas.
- Rate limit headers (RateLimit-Limit, RateLimit-Remaining) are now included in all booking responses.
- Added 429 response with rate_limit_exceeded error code and Retry-After header when quota is exceeded.
- API keys can be provided via x-api-key or x-booking-api-key headers (x-api-key takes precedence).
- Health and readiness endpoints are exempt from rate limiting and require no API key.
- Configurable rate limit plans with support for key-to-plan mappings.
- LRU eviction ensures bounded memory usage for tracked clients.

## 1.4.0 - 2025-02-10

- Added booking date validation.
- Added readiness reporting for deployments.
- Improved error messages for malformed JSON.

## 1.3.0 - 2024-11-18

- Added delete-booking support.
- Kept the sample data set small for local development.

## 1.2.0 - 2024-08-02

- Returned stable error codes from the HTTP API.
