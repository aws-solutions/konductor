# Plan for the 2026-12-01 release

A7 stays out: the vendor has no sandbox keys yet. The other six items fit in two days for three people.

Overlaps found in the code:

- The export prints the model's `FIELDS` list (`src/export/csv.js`), so the currency field (A1) changes the CSV by
  itself. A1 merges first with the export test updated; A2 then fixes the column position and its notice text.
- Login (A4) reads its settings through `src/config.js`, which A5 rewrites to read `config/app.json`. A5 merges
  before A4 starts, and A4 puts its key in the new file.

Day 1: Ana on A1, Cy on A5, Bo on A3. Day 2: Ana on A2, Cy on A4, Bo on A6.

Every package is built alone in `work/<package>/` from the code merged before it, then merged in `mergeOrder`. The
merge log is `docs/plan/merge-log.md`.

```json
{
  "waves": [["A3", "A5", "A1"], ["A6", "A4", "A2"]],
  "packages": [
    { "id": "currency-model", "items": ["A1"], "owner": "Ana", "files": ["src/models/invoice.js", "test/export.test.js"], "doneWhen": "currency is validated (EUR default for old records) and the export test expects the new column" },
    { "id": "currency-column", "items": ["A2"], "owner": "Ana", "files": ["src/export/csv.js", "test/export.test.js"], "doneWhen": "currency is the last CSV column and the export test passes" },
    { "id": "config-json", "items": ["A5"], "owner": "Cy", "files": ["src/config.js", "config/app.json", "test/config.test.js"], "doneWhen": "the loader reads app.json and falls back to app.ini; a test covers both" },
    { "id": "login-limit", "items": ["A4"], "owner": "Cy", "files": ["src/auth/login.js", "config/app.json", "test/login.test.js"], "doneWhen": "a sixth failed login within a minute is refused by default; the limit is a setting" },
    { "id": "help-text", "items": ["A3"], "owner": "Bo", "files": ["src/cli.js"], "doneWhen": "--help prints --since" },
    { "id": "ci-two-zones", "items": ["A6"], "owner": "Bo", "files": [".ci/pipeline.yml"], "doneWhen": "CI runs the suite under TZ=UTC and TZ=Europe/Berlin" }
  ],
  "dependencies": [
    { "before": "A1", "after": "A2", "reason": "the export prints the model FIELDS list, so the column follows the field" },
    { "before": "A5", "after": "A4", "reason": "the login setting goes into the new config file" }
  ],
  "conflicts": [
    { "items": ["A4", "A5"], "reason": "both change the configuration: A5 moves app.ini to app.json, A4 adds a key" }
  ],
  "notScheduled": [{ "item": "A7", "reason": "on hold until the vendor issues sandbox keys" }],
  "mergeOrder": ["help-text", "config-json", "currency-model", "ci-two-zones", "login-limit", "currency-column"]
}
```
