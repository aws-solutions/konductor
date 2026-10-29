# order-migrator

Migrates a directory holding `orders.jsonl` from schema 1 to schema 2.

```
node bin/migrate.js up --dir data
node bin/migrate.js down --dir data      # restores the original file
node bin/migrate.js up --dir data --dry-run
```

`up` rewrites `orders.jsonl` in place. It keeps a copy of the original in `orders.v1.bak` (created once) and
records hashes in `.migration-state.json`. Records it cannot convert are listed in `rejects.jsonl`. Running `up`
again changes nothing. `down` restores the original file and removes the backup and state file; it refuses
(exit 3) when `orders.jsonl` was edited after `up`, unless `--force` is given.

The schemas and the full command contract are in `docs/SCHEMA.md`. `scripts/check-data.js` prints a quick
summary of a data directory.

## Layout

- `bin/migrate.js` command line entry
- `src/migrate.js` `up` and `down`
- `src/schema.js` record conversion
- `src/money.js`, `src/dates.js`, `src/address.js` field conversions
- `src/io.js` file helpers
- `data/orders.jsonl` sample schema 1 data
