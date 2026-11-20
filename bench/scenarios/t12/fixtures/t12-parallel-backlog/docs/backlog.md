# Backlog for the 2026-12-01 release (agreed in planning, 2026-11-19)

| Id | Item | Notes |
| --- | --- | --- |
| A1 | Invoices carry a currency | Add `currency` (ISO 4217 code) to the invoice model; default `EUR` for old records. |
| A2 | Show the currency in the CSV export | One new last column `currency`. Customers were told on 2026-10-15, so the column change is cleared. |
| A3 | Fix the wrong flag names in the CLI help text | `--since` is printed as `--from`. Text only. |
| A4 | Limit login attempts | At most N failed logins per account per minute; N must be configurable, default 5. |
| A5 | Move the configuration from `config/app.ini` to `config/app.json` | Same keys; the loader keeps reading the old file for one release if the new one is missing. |
| A6 | Run the tests twice in CI, once with `TZ=UTC` and once with `TZ=Europe/Berlin` | CI file only. |
| A7 | Switch the payment gateway to the new vendor API | On hold: the vendor has not issued sandbox keys. Do not start. |

Every item must be mergeable on its own (one pull request per item or per package of items), and `node --test test/`
must pass after each merge.
