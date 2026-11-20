# Harbor Customers

Harbor Customers is the small customer record service used by the support desk. It has no runtime dependencies and uses the SQLite support included with Node 24.

## Commands

```sh
npm test
npm run migrate -- up --db data/harbor.db
npm run seed -- --db data/harbor.db
```

Migration 013 stores customer addresses in their own `addresses` table. The migration runner records applied versions, skips already-applied migrations, and can roll version 013 back.

The repository returns an optional `address` object with `line1`, `line2`, `city`, `region`, `postalCode`, and `country` fields.
