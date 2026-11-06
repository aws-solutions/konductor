# ttl-cache

A small in-memory cache for the catalog service.

## Layout

- `config/app.json`: service settings.
- `src/config.js`: reads the settings and hands them to the other modules.
- `src/cache.js`: the cache. Entries expire once they are older than `ttlMs`.
- `src/retry.js`: retries a call with a fixed delay.
- `src/duration.js`: turns duration text such as `250ms`, `90s` or `5m` into milliseconds.

## Config

Durations in `config/app.json` are written as text with a unit (`ms`, `s` or `m`).
The modules work in milliseconds.

## Tests

Run `npm test` (the built-in Node test runner).
