# Ledger Lens

Ledger Lens is a small command-line report reader for the operations team. It reads a JSON export and writes a table, CSV, or JSON view to standard output.

## Quick start

```sh
node bin/report.js data/monthly-sales.json
node bin/report.js data/monthly-sales.json --format csv
node bin/report.js data/monthly-sales.json --compact
```

The input file contains a `title`, a `columns` list, and an array of row objects. The tool has no runtime dependencies and is intended to run with Node.js 24.

For command details, see [docs/usage.md](docs/usage.md). Formatting conventions are in [docs/formatting.md](docs/formatting.md).
