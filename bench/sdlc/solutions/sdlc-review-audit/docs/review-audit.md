# Audit of Sam's review of the cart change

Checked every finding of `reviews/review-by-sam.md` against `src/cart.js` and `CHANGE.diff`, then reviewed the
change again for what the review left out.

## Missed defects

- [high] `src/cart.js:29` Stored XSS: `summaryHtml` puts `ownerName`, which the customer types at sign-up, into
  HTML without escaping. R6 looked at this line and only raised style. Fix: escape `&<>"'` or render with a
  library that escapes by default.
- [medium] `src/cart.js:16` Coupon codes are compared case-sensitively, though the comment says codes are
  case-insensitive and customers type them by hand, so `save10` fails for `SAVE10`. Fix: compare `toLowerCase()`
  of both.
- [high] `src/cart.js:9` `percentOff` is not bounded. Marketing types it with no limits, so a value above 100
  makes the total negative. Fix: reject coupons outside 0 to 100 when they are loaded.

## Wrong claims

- R2 is wrong: `liveCoupons` keeps a coupon with no `expiresAt` (`!c.expiresAt ||` at line 34), and
  `test/cart.test.js` pins it.
- R5 is wrong: `findCoupon` returns `null` when nothing matches (`|| null` at line 16).

## Severity corrections

- R4: low -> high. A second add of the same product sets the quantity instead of adding to it, so the cart loses
  items and the customer is charged for fewer than they chose.
- R3: critical -> nit. It is a naming preference with no effect on behaviour.

R1 and R6 stand as written.

Verdict: the approval does not stand; request changes. M2 (the XSS) blocks the merge on its own.
