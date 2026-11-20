# Harbor Customers

Harbor Customers is the small customer record service used by the support desk. It has no runtime dependencies and uses the SQLite support included with Node 24.

## Commands

```sh
npm test
npm run migrate -- up --db data/harbor.db
npm run seed -- --db data/harbor.db
```

The service stores customer records in SQLite. The migration files are ordered and the migration runner records applied versions in `schema_migrations`.

## Layout

- `src/` contains the database adapter, repository, service, and command-line entry points.
- `migrations/` contains numbered schema changes.
- `test/` contains the fast local test suite.
- `docs/` contains notes for operators and API consumers.

The HTTP adapter is intentionally small; applications can mount the handlers exported from `src/http.js`.
