# Design review: stock reservations at checkout

Reviewed `docs/design.md` for missing targets, assumptions, failure modes, security, rollout and consistency.
Ranked by risk; the first three block launch.

## Gaps

- [high] §3, §5: No failure mode for the payment provider. It times out on about 1 in 500 calls (README); the design
  does not say whether the reservation is released, the charge retried with the same idempotency key, or the
  customer told. Question: what state is an order in after a timeout, and who releases its stock?
- [high] §5: `POST /admin/refunds` names no authentication or authorization. Anyone who reaches it can refund any
  order. Fix: require the support role and log each refund with the operator id.
- [high] §8: No rollout or migration plan. The new `reservations` table and the new `orders.status` values need a
  backfill rule for orders open at deploy time, a deploy order (readers before writers), a feature flag and a
  rollback step.
- [medium] §4: Unstated assumption that node clocks agree: each node compares `expiresAt` with its own clock, and
  its in-memory timers are lost when the node restarts, so stock stays reserved. Fix: expire in the store, by one clock.
- [medium] §2, §3: No latency or throughput target. "Checkout stays fast" has no number; the README gives a peak of
  40 orders a second. Ask for a p99 for reserve and pay at that peak, and the mechanism that meets it.
- [medium] §3: The diagram contradicts the text. The text says checkout calls the inventory service through the
  stock cache; the sequence diagram calls `InventoryDB` directly and never uses `StockSvc`.
- [low] §4: Reservations keep the customer's email and shipping address with no retention rule. Fix: keep only the
  order id, or delete personal data when the reservation ends.

Covered and not flagged: idempotency of reserve (§4), rate limiting (§6), and the expired-reservations alarm (§7).
