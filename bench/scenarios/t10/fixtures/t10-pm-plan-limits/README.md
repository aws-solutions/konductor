# Sprig Track API

Sprig Track is the small-team project tracker used by the Sprig workspace product. It has a deliberately small HTTP surface and stores development data in JSON files so a local installation is easy to inspect.

## Local run

Use Node 24 or newer. No package installation is needed.

```sh
node src/server.js
npm test
```

The default server listens on port 4070. Set `PORT` to choose another port. The application creates its data file when it is first used. Tests use temporary files and the same repository modules as the server.

## Shape of the service

`src/http/router.js` owns route matching, `src/repositories/` owns persistence, and `src/services/` contains rules shared by the HTTP and batch entry points. The JSON store serializes writes to one store instance. Accounts, projects, and membership records are separate collections in the same store.

The sample plan catalogue and operational metadata live under `config/` and `ops/`. A few scripts validate these files in CI. See `docs/architecture.md` for boundaries and `docs/runbook.md` for operational commands.

## API conventions

Responses are JSON. IDs are opaque strings. Dates sent by clients use ISO 8601 with an explicit UTC offset. A request that cannot be fulfilled returns an object with `error.code` and `error.message`; route modules do not expose stack traces.
