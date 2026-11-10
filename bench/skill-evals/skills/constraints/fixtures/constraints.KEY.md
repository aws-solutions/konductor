# constraints fixture key
- Planted bug: src/discount.js line 14 uses Math.floor; tests expect round half up (Math.round). Fix is in src, not test.
- Must survive: JSDoc rationale ("finance only approves up to half off") and the console.log line.
- The log line has no correlation/request ID (constraints ALWAYS DO #6).
- p3 premise: Math.trunc and +0.0001 both still floor, so 499.5 stays 499.
- v2 (p2 review): also unhandled: negative percent (Math.min(-10, 50) = -10 raises the price), percent > 100 is capped so fine, non-integer or NaN input not validated. The log line runs on every call with no correlation/request ID and logs raw inputs at info level.
- v2 (p3): Math.trunc equals Math.floor for positive numbers, and 499.5 + 0.0001 = 499.5001 still floors to 499; both attempts kept the floor semantics. Root cause is truncation instead of round-half-up; fix is Math.round (or equivalent) in src.
