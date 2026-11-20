# Release plan, 2026-12-01: who does what, in parallel

Three people from Monday to the Wednesday freeze, six items (A7 is on hold). The plan runs two waves.

## What can run at the same time, and what cannot

- **A1 before A2.** A1 adds `currency` to `FIELDS` in `src/models/invoice.js`, and `src/export/csv.js` prints exactly
  `FIELDS`, so A1 alone would already add a CSV column and break `test/export.test.js`. One package does both: A1
  adds the field, A2 makes the column the deliberate last column and updates the export test. Doing them in two
  parallel pull requests would collide on the same list and the same test.
- **A4 and A5 apart.** A5 replaces `config/app.ini` with `config/app.json` and rewrites the loader in `src/config.js`;
  A4 needs a new setting (`login.maxFailedPerMinute`, default 5) read through that loader and stored in that file.
  Run A5 first, then A4 adds its key to `app.json`. In parallel, one of them would add the key to a file the other
  deletes.
- A3 (`src/cli.js` help text) and A6 (`.ci/pipeline.yml`) touch nothing the others touch.
- A7 waits: the vendor has not issued sandbox keys.

## Waves

- Wave 1 (Monday): A1 currency field (Ana, package P1), A5 config move (Cy, P3), A3 help text and A6 CI (Bo, P4).
- Wave 2 (Tuesday): A2 currency column (Ana, finishes P1), A4 login limit (Cy, P2, after P3 is merged).

```json
{
 "waves": [
  [
   "A1",
   "A5"
  ]
 ],
 "packages": [
  {
   "id": "P1",
   "items": [
    "A1"
   ],
   "owner": "Ana",
   "files": [
    "src/models/invoice.js",
    "src/export/csv.js"
   ],
   "doneWhen": "Invoices validate currency (default EUR for old records), the CSV ends with a currency column, and node --test test/ passes."
  },
  {
   "id": "P3",
   "items": [
    "A5"
   ],
   "owner": "Cy",
   "files": [
    "src/config.js",
    "config/app.json"
   ],
   "doneWhen": "src/config.js reads config/app.json, falls back to app.ini when it is missing, and a test covers both."
  }
 ],
 "dependencies": [
  {
   "before": "A1",
   "after": "A2",
   "reason": "csv.js prints the model's FIELDS list, so the currency field and the new column change the same list and the same export test."
  }
 ],
 "conflicts": [
  {
   "items": [
    "A4"
   ],
   "reason": "Both change the configuration: A5 replaces config/app.ini and rewrites src/config.js, A4 adds a key to it."
  }
 ],
 "notScheduled": [
  {
   "item": "A7",
   "reason": "On hold: the vendor has not issued sandbox keys."
  }
 ],
 "mergeOrder": [
  "P4",
  "P3"
 ]
}
```
