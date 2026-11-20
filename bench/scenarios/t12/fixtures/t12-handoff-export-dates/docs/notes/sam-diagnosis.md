# Sam's notes on BILL-1187 (2026-11-18)

- Reproduced: `TZ=Pacific/Auckland node --test test/export.test.js` fails on the INV-3001 line; with `TZ=UTC` it passes.
  The CI box runs in UTC, which is why nobody saw it. The billing export server runs in Auckland time.
- Cause, I am fairly sure: `src/format-date.js` builds the date with the local-time getters (`getFullYear`,
  `getMonth`, `getDate`). The billing team wants the invoice's UTC date. The UTC getters should fix it.
- I checked `src/legacy/old-export.js`: it slices the ISO string, so it is not affected. Leave it alone anyway, it is
  frozen.
- Not done: a test that fails under UTC too. The current test only fails in Auckland time, so CI on UTC would never
  have caught it. A test that sets the zone for the call (or runs the suite in both zones, as CI does) would.
- I did not look at due dates; they go through the same function, so they are wrong the same way.
- Ruth (payments) asked that we do not touch the column order: the two importers that read the CSV by position break.
