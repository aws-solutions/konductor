# Northstar export service

Northstar is a small Node.js service that exposes health information and a newline-delimited JSON export for the records in its local data source.

## Run

Use Node.js 24 or newer. The service listens on `PORT` (3000 by default).

```sh
npm start
```

`GET /health` returns a short status document. `GET /export` writes one JSON record per line.

## Development

There are no runtime dependencies. Run `npm test` for the test suite and `npm run check` for the lightweight repository checks.
