# ledgerline

Billing service. Plain Node.js 24, CommonJS, no dependencies. `node --test test/` runs the tests.

- `src/models/invoice.js`: the invoice model and its validation.
- `src/export/csv.js`: the CSV export (reads the model's fields).
- `src/auth/login.js`: login; reads its limits through `src/config.js`.
- `src/config.js`: loads `config/app.ini` and exposes `get(key, fallback)`.
- `src/cli.js`: the command-line tool and its help text.
- `.ci/pipeline.yml`: the CI pipeline.
