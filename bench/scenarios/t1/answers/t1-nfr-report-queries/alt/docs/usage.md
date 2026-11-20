# Usage

The loader takes a destination SQLite filename and replaces its tables with the sample schema and data:

```sh
python3 scripts/load_fixture.py report.sqlite
```

The report command requires an existing database, an ISO month such as `2024-01`, an output format, and an output path. Use `-` as the output path to print the chosen format. Existing output files are replaced. The `--month` argument must be in `YYYY-MM` format; malformed values are rejected with an error.

```sh
python3 -m reportjob.cli --db report.sqlite --month 2024-01 --format json --output january.json
```

## Performance

The report uses a single SQL query per month, streaming results to keep memory usage low. Reports with 12,000 order rows stay below 8 MiB of peak memory. Empty months produce valid empty output.

## Instrumentation

`ReportDatabase` accepts an optional `connection` parameter for callers who want to instrument database work:

```python
import sqlite3
from reportjob.database import ReportDatabase

with sqlite3.connect("report.sqlite") as conn:
    db = ReportDatabase(connection=conn)
    # Use db with an external connection for tracing, profiling, etc.
```
