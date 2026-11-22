# API notes

The application adapter maps these operations to HTTP routes. Request bodies
use JSON and customer IDs are lower-case slugs.

## Earn

`POST /customers/:id/earn` accepts `subtotal` and an optional `tier`. The
response includes the points calculated for that order and the new balance.
Earn values keep two decimal places. The handler retries a failed calculation
once so that short checkout interruptions do not surface as errors. The
standard, plus, and premier multipliers are defined in `data/tiers.json`.

A missing or unknown tier uses the standard multiplier. The response status is
201 when the balance has been updated.

## Redeem

`POST /customers/:id/redeem` accepts a positive `points` value. The configured
maximum redemption is 10,000 points per request. A successful response includes
the resulting balance and returns status 200. Decimal values are accepted.

The service rejects an empty customer ID and non-positive point values. The
caller supplies a customer ID in the route path when using the HTTP adapter.

## Staff

`GET /admin/customers/:id/balance` is available to users with the `admin` role.
`POST /admin/customers/:id/adjust` updates a balance for support tooling. An
adjustment may be positive or negative and returns the updated balance.
