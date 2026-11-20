# tallyroll

Invoice exports for the billing team. Plain Node.js 24, CommonJS, no dependencies.

- `node --test test/` runs the tests.
- `node src/export.js test/fixtures/invoices.json` prints the CSV export.

`src/legacy/` holds the 2023 exporter that two old customers still call. It is frozen and owned by the payments team.
See `CONTRIBUTING.md` before you push anything.
