# Review: patches/0001-overlap-check.patch

Reviewer: agent, for Ravi. Not applied; I ran the current tests against a scratch copy with the patch applied, and
two of them fail.

1. The room check is gone. `conflicts()` now returns bookings of every room that overlap in time, so a booking in
   Cedar blocks Birch. The test "clashes are found in the same room only" fails with the patch.
2. Back-to-back bookings now clash. `ms(b.end) >= start` counts a booking that ends exactly when the candidate starts,
   and `ms(b.start) > end` keeps going past one that starts exactly when the candidate ends. Both comparisons need to
   be strict, as before. The test "back-to-back bookings do not clash" fails.
3. It is not faster. It copies and sorts all bookings on every call (n log n) where the old filter was one pass. If
   the desk screen is slow, keep bookings sorted per room once, outside `conflicts()`.

```json
{
  "verdict": "request-changes",
  "findings": [
    { "file": "src/overlap.js", "line": 10, "problem": "the room check is dropped: bookings in other rooms are reported as clashes" },
    { "file": "src/overlap.js", "line": 12, "problem": "back-to-back bookings clash: >= on the end and > on the start must be strict" },
    { "file": "src/overlap.js", "line": 10, "problem": "sorting a copy of every booking on each call is slower than the old single pass" }
  ]
}
```
