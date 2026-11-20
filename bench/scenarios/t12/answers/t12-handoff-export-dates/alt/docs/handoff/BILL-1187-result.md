# BILL-1187: what the second step did

I had only the hand-off and the five files it lists.

| Step of the hand-off | What happened |
| --- | --- |
| 1. See the bug | The Auckland run of `test/export.test.js` failed on INV-3001 (`2026-11-01`); the UTC run passed. Cause confirmed. |
| 2. Fix `invoiceDate()` | It now returns the first ten characters of `toISOString()`, which is always the UTC date. |
| 3. Regression test | New `test/format-date.test.js` sets `process.env.TZ` to Pacific/Auckland inside the test. |
| 4. Suite and pull request | Suite green in both zones. Branch and pull request are left to the owner. |

The INV-3001 line for the pull request: before `INV-3001,Harbor & Pine,2026-11-01,2026-12-01,125000,NZD`, after
`INV-3001,Harbor & Pine,2026-10-31,2026-11-30,125000,NZD` (both under `TZ=Pacific/Auckland`).

```json
{
  "doneWhen": [
    { "criterion": "The full suite passes with TZ=UTC and with TZ=Pacific/Auckland.", "met": true, "evidence": "TZ=UTC: 3 pass, 0 fail; TZ=Pacific/Auckland: 3 pass, 0 fail." },
    { "criterion": "test/format-date.test.js fails before the fix even when run with TZ=UTC, and passes after it.", "met": true, "evidence": "With the old invoiceDate, TZ=UTC node --test test/format-date.test.js failed (2026-11-01 vs 2026-10-31); with the fix it passes." },
    { "criterion": "The pull request names BILL-1187 and shows the INV-3001 line before and after.", "met": false, "evidence": "Opening the pull request is the owner's step; the before and after lines are in this file." }
  ],
  "ranCommands": [
    "TZ=Pacific/Auckland node --test test/export.test.js",
    "TZ=UTC node --test test/format-date.test.js",
    "TZ=UTC node --test test/*.test.js && TZ=Pacific/Auckland node --test test/*.test.js"
  ],
  "changedFiles": ["src/format-date.js", "test/format-date.test.js"],
  "readFiles": ["docs/handoff/BILL-1187.md", "docs/bug-1187.md", "src/format-date.js", "src/export.js", "test/export.test.js", "CONTRIBUTING.md"]
}
```
