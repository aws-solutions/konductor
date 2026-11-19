# Monthly customer reports

This small Python 3.12 job turns order data in SQLite into monthly CSV or JSON reports. It uses only the Python standard library.

## Quick start

Create a database from the checked-in sample SQL, then render a report:

```sh
python3 scripts/load_fixture.py /tmp/orders.sqlite
python3 -m reportjob.cli --db /tmp/orders.sqlite --month 2024-01 --format csv --output /tmp/january.csv
```

The report contains one row for each order. Dates use ISO format and money is stored as integer cents. The command accepts `csv` and `json` formats. A report can be written to `-` for standard output.

Run the tests with:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

See [usage](docs/usage.md) and [the data model](docs/data-model.md) for details.
