# catalog-gateway

Looks up products for the shop pages. Prices and stock state come from the supplier's legacy item service; the
category listing comes from the nightly catalog snapshot.

```js
const { createCatalogService } = require('./src');

const catalog = createCatalogService({ supplier, items: snapshot });
await catalog.lookup('SKU-1');       // { sku: 'SKU-1', name: 'Desk lamp', priceCents: 1250, active: true, category: 'lighting' }
await catalog.priceLabel('SKU-1');   // '$12.50'
catalog.listByCategory('lighting');  // [ ...items ]
```

- `supplier` has `fetchItem(sku)`, which returns a promise of a legacy record (see `docs/SUPPLIER-API.md`).
- `items` is the snapshot: an array of legacy records.
- `clock` (`{ now() }`) and `sleep(ms)` may be passed for tests.

## Layout

- `src/index.js` `createCatalogService`
- `src/catalog.js` lookups
- `src/pricing.js` price labels
- `src/search.js` category listing
- `src/supplier/legacy-client.js` HTTP client of the supplier service (not used by tests)
- `src/errors.js`, `src/clock.js`
- `config/service.json` the limits from `docs/DESIGN.md`
