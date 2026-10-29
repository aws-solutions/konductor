# Reorder report is missing items at their reorder level

## Symptom

Operations reported that the Gadget (id 2, quantity 5, reorder level 5) never appears in the reorder report.

## Root cause

`reorderReport` in `src/services/inventoryService.js` filtered with `i.qty < i.reorderLevel`. The README says an item is on the report when its quantity is "at or below" its level, so an item exactly at the level was dropped. The existing tests only used a clearly low item (id 3) and a well-stocked one (id 1), so they passed.

## Change

- `src/services/inventoryService.js`: the comparison is now `i.qty <= i.reorderLevel`. Nothing else changed.
- `test/reorderBoundary.test.js`: new test that the report includes item 2, whose quantity equals its level.

## Test results

- Before the fix, the new test failed: item 2 was not in the report (the report returned only item 3).
- After the fix, `node --test` reports 9 tests, 9 passing, 0 failing. The report now returns items 2 and 3 and not item 1.
