# MUX-3: Add a report for items needing replenishment

## What is missing

The library can select items that need replenishment, but it cannot turn that selection into the short report used by the warehouse handoff.

## How to see it

Try to produce a handoff report from two selected items: `A-1`, named `Blue bin`, with `2` on hand and a reorder point of `5`, followed by `B-2`, named `Red bin`, with `0` on hand and a reorder point of `1`. There is currently no report operation for this output.

## Right behaviour

Add a public `renderReorderReport` operation that accepts the selected items and returns exactly:

```text
REORDER REPORT
A-1 | Blue bin | 2/5
B-2 | Red bin | 0/1
```

The item order must be preserved. For an empty selection, return exactly `REORDER REPORT\nNONE`. Do not add a trailing newline.
