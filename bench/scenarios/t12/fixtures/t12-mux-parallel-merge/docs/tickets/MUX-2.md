# MUX-2: Zero-quantity price lines are rejected

## What is wrong

The pricing operation rejects a line whose quantity is zero. The warehouse uses zero-quantity lines when an item is present in a catalog but currently has no stock, so the operation cannot produce a complete stock valuation.

## How to see it

Call the public `lineTotal` operation with a unit price of `12.50`, quantity `0`, and no discount. It throws instead of returning a total.

## Right behaviour

A non-negative integer quantity is valid. Quantity `0` must return the number `0`, including when the unit price is positive and the discount is `100`. Negative, fractional, or non-numeric quantities must still be rejected with the existing quantity validation error.
