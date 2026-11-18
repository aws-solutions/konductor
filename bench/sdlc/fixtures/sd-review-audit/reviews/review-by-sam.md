# Review of the cart change (Sam)

Looked at the totals, coupons and the summary.

- R1 [low] `src/cart.js:9` The discount is rounded before tax, so a cart can be off by a cent against the
  receipt, which rounds once at the end.
- R2 [high] `src/cart.js:34` `liveCoupons` drops coupons that have no `expiresAt`, so permanent coupons stop working.
- R3 [critical] `src/cart.js:8` The loop variable `it` should be called `item`.
- R4 [low] `src/cart.js:22` Adding a product that is already in the cart replaces its quantity instead of adding to it.
- R5 [medium] `src/cart.js:16` `findCoupon` returns `undefined` when no coupon matches, and callers check for `null`.
- R6 [nit] `src/cart.js:29` A template engine would read better than a template string.

Verdict: APPROVE
