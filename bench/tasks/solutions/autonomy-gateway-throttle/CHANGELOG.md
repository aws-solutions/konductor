# Changelog

## Unreleased

- Rate limit: 100 requests per minute per user (per IP address when no user), 429 with `retryAfterSec`.

## 0.3.0

- Handlers receive route params as `ctx.params`.
- `HttpError` carries a status.

## 0.2.0

- Request normalization.
