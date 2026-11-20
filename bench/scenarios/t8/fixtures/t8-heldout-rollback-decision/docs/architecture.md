# orders-api architecture (short)

- Edge proxy (`edge`) terminates TLS and spreads requests round-robin over the healthy orders-api hosts.
- orders-api serves catalog, cart, delivery slots and checkout. Slot search calls the maps-geo vendor for route times.
- Checkout calls the payments gateway (owned by the payments team) to authorise the card. The gateway returns
  `approved` or `soft_decline` with a code; orders-api answers the app with HTTP 200 either way and shows the
  customer a "payment did not go through" screen on a decline.
- Every authorisation carries a request key so a retried call is not charged twice. The gateway rejects a key it has
  already seen with a different amount.
- One Postgres primary with one replica; migrations run from the deploy tool before new code starts.
