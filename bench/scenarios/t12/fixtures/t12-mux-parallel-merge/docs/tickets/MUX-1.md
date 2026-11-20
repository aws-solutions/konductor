# MUX-1: Reorder report misses stock at the threshold

## What is wrong

The reorder view leaves an item out when its on-hand count is exactly the count at which the warehouse wants to replenish it. An item at that level needs attention just as much as an item below it.

## How to see it

Build an item with a reorder point of `5`, give it exactly `5` units on hand, and pass the item list to the existing `findReorderItems` operation. The result is empty even though the item should be listed.

## Right behaviour

An item belongs in the reorder result when `onHand` is less than or equal to `reorderPoint`. Items above the reorder point must remain out of the result, and the original input order must be preserved.

The boundary is important: an item at `0` on hand with a reorder point of `0` is also a valid threshold match.
