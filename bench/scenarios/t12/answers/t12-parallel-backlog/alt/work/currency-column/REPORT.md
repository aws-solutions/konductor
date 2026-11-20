# currency-column (A2), Ana

`src/export/csv.js` now has its own `COLUMNS` list with currency pinned last, so the public column order no longer
follows whatever the model adds. `test/export.test.js` (as merged by currency-model) gains a column-order test.
Started from the code after every other package was merged.

Ran `node --test test/*.test.js`: 6 passing, 0 failing.
