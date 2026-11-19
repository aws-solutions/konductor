# Cart service

Cart identifiers are non-empty strings. A line has a SKU, a non-negative unit
price in cents, and an integer quantity from 1 through 99. Adding an existing
SKU increases its quantity and keeps the original line price. A cart can be
empty, and removing an unknown SKU leaves it unchanged.

`CartStore` keeps carts in memory. Calling `getCart` for the same identifier
returns the current state, while `clear` replaces that cart with an empty one.
