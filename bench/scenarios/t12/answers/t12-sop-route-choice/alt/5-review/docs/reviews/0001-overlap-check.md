# 0001-overlap-check: review

Ravi, thanks for looking at the desk screen speed. I tried the patch in a throwaway copy (not on main) and it needs
another round before you apply it.

- A Cedar booking now blocks a Birch request: the new loop never compares `b.room` with `candidate.room`.
- A stay ending at 10:00 now clashes with one starting at 10:00 on the same day. With `>=` the check treats touching
  intervals as overlapping; the old code used strict `<` on both sides.

Both show up in the existing suite once the patch is in.

```json
{
  "verdict": "request-changes",
  "findings": [
    { "file": "src/overlap.js", "line": 11, "problem": "no comparison of rooms: clashes are reported across different rooms" },
    { "file": "src/overlap.js", "line": 12, "problem": "touching intervals (one ends when the other starts) are reported as a clash" }
  ]
}
```
