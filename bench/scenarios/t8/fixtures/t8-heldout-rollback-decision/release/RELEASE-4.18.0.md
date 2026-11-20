# orders-api 4.18.0

Release manager: Tom Okafor. Build 5488 (green). Planned rollout: half the fleet on 2026-11-20, full fleet the same
afternoon if the half stage looks good.

## Changes

- PROMO-118: checkout accepts a promo code; new `orders.promo_code` column and `promo_redemptions` table (migration 0042).
- PROMO-121: promo banner on the cart page, behind the `promo_banner` flag (on for all users from 4.18.0).
- PAY-2291: the payments client moved onto the shared request middleware (headers, retries and request keys now come
  from the middleware instead of the client).
- SLOT-77: delivery slot search caches empty results for 30 seconds.
- OPS-940: health check reports the build number.
- Dependency bumps: http client 3.4.2, JSON library 2.17.1.

## Rollout

See `rollout.yaml`. Stage `half` puts `oa-3` and `oa-4` on 4.18.0; `oa-1` and `oa-2` stay on 4.17.3 until stage
`full`.

## Known issues

None at release time.
