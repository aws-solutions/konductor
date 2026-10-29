# Report format

## Current behavior (text)

Characterized by the golden tests. Do not change it.

- Lines are sorted by `sku` (plain string comparison), equal skus keep their input order.
- Amounts are rounded to the currency's digits (2, or 0 for JPY) with `Math.round`.
- Tax is the country rate applied to the sum of the taxable net amounts, rounded once.
- Shipping is waived when the subtotal is above 100.

## Additions for the next release

Two additions. Everything else, for every invoice that renders today, stays identical.

### CSV output

`renderReport(invoice, { format: 'csv' })`. The default format is `'text'`; any other value throws
`RangeError`.

- Header row: `sku,description,qty,unit_price,discount,net`.
- One row per invoice line in the same order as the text report. `qty` is printed as given;
  `unit_price`, `discount` (the discount amount as a positive number, `0.00` when none) and `net`
  are plain decimals with the currency's digits, no symbol and no thousands separator. A negative
  amount has a leading minus sign; zero never prints as `-0.00`.
- Then four summary rows whose first field is `subtotal`, `tax`, `shipping` and `total`, whose last
  field is the amount in the same plain format, and whose other four fields are empty. The `shipping`
  row is always present and shows the shipping actually charged (`0.00` when waived or absent).
- A field is wrapped in double quotes when it contains a comma, a double quote or a line break;
  double quotes inside are doubled.
- Rows end with `\r\n`, including the last one.

### Euro formatting

For `currency: 'EUR'` the text report prints amounts as `1.234,56 €`: `.` between thousands, `,` before
the cents, then a space and the euro sign. A negative amount is `-1.234,56 €`. Column alignment uses the
printed string length as before. Other currencies are unchanged.
