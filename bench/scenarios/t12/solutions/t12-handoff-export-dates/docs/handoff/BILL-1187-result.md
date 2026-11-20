# BILL-1187: result of the hand-off

Worked from `docs/handoff/BILL-1187.md` and the files it lists, nothing else.

- Confirmed Sam's diagnosis first: `TZ=Pacific/Auckland node --test test/export.test.js` failed on the INV-3001 line
  (2026-11-01 instead of 2026-10-31); `TZ=UTC` passed.
- `src/format-date.js` now uses `getUTCFullYear`, `getUTCMonth` and `getUTCDate`. Due dates go through the same
  function and are fixed with it.
- `test/export.test.js` has a new test that runs `invoiceDate` in child processes under `Pacific/Auckland` and
  `America/Los_Angeles`. With the old `src/format-date.js` it fails even when the suite runs with `TZ=UTC`.
- Columns, `test/fixtures/invoices.json` and `src/legacy/` are untouched.

Left for the owner: the `fix/BILL-1187-utc-dates` branch and the pull request (with INV-3001 before and after:
`2026-11-01,2026-12-01` before, `2026-10-31,2026-11-30` after) are not part of this run.

```json
{
  "readFiles": ["docs/handoff/BILL-1187.md", "src/format-date.js", "src/export.js", "test/export.test.js", "test/fixtures/invoices.json", "docs/notes/sam-diagnosis.md", "CONTRIBUTING.md"],
  "changedFiles": ["src/format-date.js", "test/export.test.js"],
  "ranCommands": [
    "TZ=Pacific/Auckland node --test test/export.test.js",
    "TZ=UTC node --test test/*.test.js",
    "TZ=Pacific/Auckland node --test test/*.test.js"
  ],
  "doneWhen": [
    { "criterion": "node --test test/*.test.js passes under TZ=UTC and TZ=Pacific/Auckland (both time zones).", "met": true, "evidence": "Both runs: 3 tests, 3 pass, 0 fail." },
    { "criterion": "A new test fails on the original code even when the suite runs in UTC.", "met": true, "evidence": "With the old src/format-date.js, TZ=UTC node --test test/*.test.js fails 'dates do not depend on the server time zone'." },
    { "criterion": "The pull request names BILL-1187 and shows INV-3001 before and after.", "met": false, "evidence": "Not part of this run: the owner opens the pull request; before and after lines are given above." }
  ]
}
```
