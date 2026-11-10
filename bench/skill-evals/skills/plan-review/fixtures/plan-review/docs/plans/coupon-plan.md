# Plan: coupons at checkout

1. Implement the coupon feature in the billing module.
2. Add a `applyCoupon(invoice, code)` call inside `computeTotal` in `src/billing/invoice.js`, reusing the existing `applyCoupon` helper there.
3. Put the coupon table in `src/billing/discounts.js` next to the other discount rules.
4. Update the config with the new coupon settings.
5. Handle edge cases appropriately (expired codes, etc.).
6. Make sure it works and tests pass.
