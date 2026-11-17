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

## Targets

How the service meets each target of `docs/DESIGN.md` (numbers in `config/service.json`):

| target | mechanism | code |
|---|---|---|
| NFR-1 | cache, TTL 60 s, 1000 entries, least recently used dropped; one shared call per SKU in flight | `src/cache.js`, `src/catalog.js` |
| NFR-2 | at most 4 supplier calls at once, the rest queued | `src/limit.js` |
| NFR-3 | 3 attempts on `BUSY` or `TIMEOUT`, 50 ms then 100 ms apart, then `SUPPLIER_UNAVAILABLE` | `src/retry.js` |
| NFR-4 | index by category, built once | `src/search.js` |

Supplier records become domain items only in `src/supplier/translate.js`.

## Layout

- `src/index.js` `createCatalogService`
- `src/catalog.js` lookups
- `src/cache.js`, `src/limit.js`, `src/retry.js` the target mechanisms
- `src/pricing.js` price labels
- `src/search.js` category listing
- `src/supplier/translate.js` supplier records to domain items
- `src/supplier/legacy-client.js` HTTP client of the supplier service (not used by tests)
- `src/errors.js`, `src/clock.js`
- `config/service.json` the limits from `docs/DESIGN.md`
