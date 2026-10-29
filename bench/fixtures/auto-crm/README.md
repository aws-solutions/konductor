# crm-lite

Customers and their orders, stored as JSON files in `data/`. There is no database; every function takes
the data directory so tests can use a scratch copy.

```js
const { listCustomers, ordersFor } = require('./src');

listCustomers('data');       // [{ id: 'c1', name: 'Ana Ruiz', ... }]
ordersFor('data', 'c1');     // [{ id: 'o1', customerId: 'c1', totalCents: 5000 }]
```

## Data

See `docs/DATA.md`. Files are written with `src/store.js`, which replaces the file in one step.

## Scripts

- `node scripts/seed-demo.js [dataDir]` writes a small demo data set (it overwrites the files).

## Layout

- `src/customers.js`, `src/orders.js` read access to the two files
- `src/store.js` JSON file helpers
- `src/normalize.js` input cleanup helpers
- `scripts/` one-off scripts
