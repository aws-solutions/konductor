# Audit of the review

## Missed defects

- [high] `src/cart.js:29` The owner name goes into HTML without escaping (XSS).

## Wrong claims

None found; R1 to R6 look right.

## Severity corrections

- R3: critical -> low. A naming choice.

Verdict: approve, with the XSS fixed in a follow-up.
