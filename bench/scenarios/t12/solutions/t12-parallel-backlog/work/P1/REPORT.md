# P1: A1 currency field and A2 currency column (Ana)

- A1: `currency` is the last entry of `FIELDS` in `src/models/invoice.js`; old records get `EUR`; a value that is not
  a three-letter ISO 4217 code is refused.
- A2: `src/export/csv.js` prints `FIELDS` in order, so `currency` is the new last CSV column with no change to the
  exporter. `test/export.test.js` expects the new header and covers the EUR default.

Built on the code after P4 and P3 were merged.

Check: `node --test test/*.test.js` printed pass 5, fail 0.
