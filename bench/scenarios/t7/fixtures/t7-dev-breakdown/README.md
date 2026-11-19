# Harbor Catalog service

This folder is a snapshot of the Harbor Catalog Node.js service and its planning exports, as of **2027-04-12 (Monday)**. The requested change is described in `docs/requests/multi-currency-prices.md`. Read the repository files as source material; do not edit this snapshot.

## What is here

- `src/` contains the HTTP handlers, catalog service, persistence adapter, response formatting, notifications, exports, and cache.
- `src/app.js` starts request dispatch; `src/server.js` starts the process; `src/config.js` holds runtime defaults.
- `src/http/products-route.js` handles the product endpoint and `src/http/serializers/product.js` shapes responses.
- `src/services/catalog-service.js` coordinates reads, `src/services/money.js` formats amounts, and `src/validation/currency.js` checks currency codes.
- `src/storage/db.js` provides the database client seam and `src/storage/product-repository.js` reads products.
- `src/cache/product-cache.js` stores in-process product results; `src/export/products-csv.js` writes partner rows; `src/notifications/price-email.js` renders notices.
- `src/legacy/pricing-legacy.js` is an older pricing module kept in the source tree.
- `tests/` contains unit and integration tests. `tests/helpers/fake-db.js` provides a database stub and `tests/helpers/product-fixture.js` builds products.
- `tests/fixtures/products.json` contains sample products; the files under `tests/unit/` cover money, cache, catalog, and repository behavior; the files under `tests/integration/` cover the route, export, and notification boundaries.
- `db/migrations/001_create_products.sql` through `004_create_audit_log.sql` are the current SQL migrations.
- `docs/architecture.md` describes component boundaries; `docs/data-dictionary.md` describes stored amounts; `docs/estimate-guide.md` gives estimates; `docs/roadmap.csv` gives release targets; `docs/team-calendar.csv` gives delivery windows; and `docs/requests/` contains the feature request.
- `docs/notes/weekly-01.md` through `weekly-08.md` are routine weekly notes.
- `package.json` and `package-lock.json` define the Node project; `.github/workflows/test.yml` runs tests; `scripts/lint-check.js` runs the lightweight lint check.
- `data/work-items.csv` is a noisy export of project work items. Its columns are `id`, `status`, `title`, `estimate_points`, `owner`, `updated`, and `comments`. Statuses `Open`, `In Progress`, and `Ready` count as unfinished work. `Closed` and `Cancelled` do not. Empty estimates are not usable estimates.
- `docs/estimate-guide.md` defines the team's point-to-work-day conversion. A work day means a normal Monday-Friday day.
- `docs/team-calendar.csv` lists the two-week delivery windows, capacity, and holidays. A holiday removes one work day from capacity. The calendar is dated 2027; each sprint starts on a Monday and ends on a Friday, with the listed start and end dates.
- `docs/roadmap.csv` is the current release view; its status values are not a substitute for the work-item status rules above.

Names in exports are matched after trimming spaces and ignoring case. A blank comment is ordinary export noise. The files include closed, cancelled, stale, and unrelated rows because this is a direct export rather than a curated backlog.

The service uses Node.js 20, CommonJS modules, PostgreSQL, and the built-in test runner. Amounts are integer minor units. Existing product amounts are in USD. API examples and tests use the same convention unless a document says otherwise.
