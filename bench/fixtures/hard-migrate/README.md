# order-migrator

Migrates a directory holding `orders.jsonl` from schema 1 to schema 2.

```
node bin/migrate.js up --dir data
node bin/migrate.js down --dir data      # not implemented yet
```

`up` rewrites `orders.jsonl` in place. It keeps a copy of the original in `orders.v1.bak`. Records it cannot
convert are listed in `rejects.jsonl`.

The schemas and the full command contract are in `docs/SCHEMA.md`. `scripts/check-data.js` prints a quick
summary of a data directory.

## Layout

- `bin/migrate.js` command line entry
- `src/migrate.js` `up` and `down`
- `src/schema.js` record conversion
- `src/money.js`, `src/dates.js`, `src/address.js` field conversions
- `src/io.js` file helpers
- `data/orders.jsonl` sample schema 1 data
