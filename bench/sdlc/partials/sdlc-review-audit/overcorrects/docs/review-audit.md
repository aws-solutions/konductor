# Audit of the review

## Missed defects

- [medium] `src/cart.js:16` Coupon codes are compared case-sensitively.
- [medium] `src/cart.js:9` percentOff above 100 makes the total negative.
- [low] `src/cart.js:3` TAX_RATE should come from config.
- [low] `src/cart.js:20` addItem should validate qty.
- [low] `src/cart.js:33` liveCoupons should take a Date.

## Wrong claims

- R1 is wrong: rounding is fine.
- R2 is wrong: coupons with no expiry are kept.
- R5 is wrong: it returns null.

## Severity corrections

- R4: low -> high. Items are lost.

Verdict: request changes.
