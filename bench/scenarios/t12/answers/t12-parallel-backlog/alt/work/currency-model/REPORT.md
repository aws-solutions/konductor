# currency-model (A1), Ana

Invoices carry `currency` (ISO 4217, `EUR` for old records). Because `src/export/csv.js` prints the model's `FIELDS`,
the CSV already gains the column here, so `test/export.test.js` is updated in this package to keep the suite green.
Started from the code after help-text and config-json were merged.

Ran `node --test test/*.test.js`: 4 passing, 0 failing.
