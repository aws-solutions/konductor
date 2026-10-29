# shop-reports

Small command line reports over exported shop data. `run(argv, { dataDir })` returns
`{ code, out }`, so the commands are easy to test; `bin/shop-reports.js` prints `out` and exits with `code`.

## Commands

- `list-orders` prints one line per order: `id  customer  status  amount`
- `customers` prints the distinct customers, one per line, sorted
- `monthly-summary` prints net revenue per UTC month from the finance ledger (posted sales and refunds, no fees or pending rows), oldest first: `2025-01  190.50`

```
$ node bin/shop-reports.js list-orders
O-1001  ana  paid  120.00
```

## Data

`docs/DATA.md` describes the two exports in `data/`. Loaders live in `src/data/`.

## Layout

- `src/cli.js` argument handling and the command table
- `src/commands/` one file per command
- `src/data/` loaders for the exports
- `src/format.js`, `src/dates.js` small helpers
