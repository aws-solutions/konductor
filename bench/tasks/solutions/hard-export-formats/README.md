# report-export

Turns report rows (plain objects) into a file in one of the export formats.

## Library

```js
const { exportReport, contentTypeFor, fileNameFor } = require('./src');

const rows = [{ region: 'north', total: 120 }, { region: 'south', total: 80 }];
exportReport(rows, { format: 'csv' });   // 'region,total\nnorth,120\nsouth,80\n'
contentTypeFor('csv');                   // 'text/csv; charset=utf-8'
fileNameFor('sales-2024', 'csv');        // 'sales-2024.csv'
```

`columns` picks and orders the columns; by default they are the keys of the first row.

## Command line

```sh
node bin/export.js --format csv --input examples/sales.json --columns region,total
```

Exit code 0 on success, 2 for an unknown format or a bad argument.

## Formats

| format | content type | extension |
|---|---|---|
| csv | `text/csv; charset=utf-8` | `.csv` |
| json | `application/json` | `.json` |
| tsv | `text/tab-separated-values; charset=utf-8` | `.tsv` |

The rules of each format are in `docs/FORMATS.md`. `listFormats()` returns the format names.

## Adding a format

Add one entry to `FORMATS` in `src/formats.js` with `contentType`, `extension` and `render(rows, columns)`. The
library, the command line and the error messages read the formats from there, so no other file changes.
