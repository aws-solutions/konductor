# invoice-text

Renders an invoice object as a fixed-width text report.

```js
const { renderReport } = require('./src');
process.stdout.write(renderReport(invoice, { width: 72 }));
```

An invoice has `number`, `customer { name, country?, vatId? }`, `currency`, `issuedAt` (ISO string),
`lines [{ sku, description, qty, unitPrice, discountPct?, taxable? }]`, and optional `shipping` and `notes`.
Unit prices are decimal amounts in the invoice currency.

## Output

The text report is what the finance team reads and what the golden files in `test/golden/` pin. Its
exact layout is relied on by a scraper downstream, so it must not change byte for byte for any invoice
the renderer accepts today.

See `docs/REPORT.md` for the format notes and the planned additions.

## Layout

- `src/report.js` the renderer
- `src/data/countries.js` tax rates by country
- `src/legacy/text-utils.js` old helpers (unused)
- `test/report.test.js` golden tests
