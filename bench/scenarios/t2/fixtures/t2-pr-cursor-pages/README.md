# Trailhead API

Trailhead is a small, file-backed project tracker used by a few internal tools and a command-line client. It exposes issues, comments, and users over HTTP. The server has no runtime dependencies and uses Node's built-in HTTP and test modules.

## Running locally

```sh
node src/server.js
```

The default listener is `127.0.0.1:4100`. Set `TRAILHEAD_PORT` to choose another port. Data is loaded from `src/data` when the process starts.

## Tests

```sh
node --test
```

The tests use an in-memory store and do not write to the checked-in data files.

## API notes

The public HTTP contract is in [`docs/api.md`](docs/api.md). Endpoints currently live under `/v1`. The API is intentionally small, but callers depend on stable response names and status codes.

## Project layout

- `src/api` contains request handlers and route registration.
- `src/store` contains the storage interface and its two implementations.
- `src/pagination` contains list navigation helpers.
- `tests` contains the no-dependency test suite.
