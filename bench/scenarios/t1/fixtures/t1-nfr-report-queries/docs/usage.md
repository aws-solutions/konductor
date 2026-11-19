# Usage

The loader takes a destination SQLite filename and replaces its tables with the sample schema and data:

```sh
python3 scripts/load_fixture.py report.sqlite
```

The report command requires an existing database, an ISO month such as `2024-01`, an output format, and an output path. Use `-` as the output path to print the chosen format. Existing output files are replaced.

```sh
python3 -m reportjob.cli --db report.sqlite --month 2024-01 --format json --output january.json
```
