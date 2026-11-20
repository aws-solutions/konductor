# Using the report command

The first positional argument is a JSON export. The command writes only the selected report to stdout and writes failures to stderr.

```sh
node bin/report.js data/monthly-sales.json --format table
node bin/report.js data/monthly-sales.json --format csv
node bin/report.js data/monthly-sales.json --format json
node bin/report.js data/monthly-sales.json --compact
```

`table` is the default. `compact` is a table view without column headings for narrow terminals. It can be combined with `--format table`; the flag is ignored for CSV and JSON output. The command accepts `--format=csv` as well as the spaced form.
