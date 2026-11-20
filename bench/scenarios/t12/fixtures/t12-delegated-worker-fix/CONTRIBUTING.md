# Contributing

- Every bug fix comes with a test that fails without the fix.
- `parseWeight()` returns kilograms as a plain number, rounded to 3 decimals. The price bands and the label both rely
  on it, so never return a string or an object from it.
- `quote()` takes the ship date either as a `Date` or as an ISO date string (`2026-03-02`); the counter app sends
  strings, the batch importer sends `Date` objects. Both must keep working.
- Keep the public names (`quote`, `parseWeight`, `deliveryDate`, `priceFor`, `labelText`) as they are.
