# Answer

The figures below come from the files in this folder; the reasoning follows the data block.

```breakdown
{
 "total_estimate_days": 17,
 "files_to_change": [
  "tests/unit/catalog-service.test.js",
  "tests/integration/products-route.test.js",
  "tests/fixtures/products.json",
  "tests/helpers/product-fixture.js",
  "tests/integration/price-email.test.js",
  "src/notifications/price-email.js",
  "tests/integration/export.test.js",
  "src/export/products-csv.js",
  "tests/unit/cache.test.js",
  "src/cache/product-cache.js",
  "src/http/products-route.js",
  "src/validation/currency.js",
  "src/config.js",
  "tests/unit/money.test.js",
  "src/services/money.js",
  "src/http/serializers/product.js",
  "src/services/catalog-service.js",
  "src/storage/product-repository.js",
  "docs/data-dictionary.md",
  "db/migrations/005_add_product_prices.sql"
 ],
 "change_order": [
  "db/migrations/005_add_product_prices.sql",
  "docs/data-dictionary.md",
  "src/storage/product-repository.js",
  "src/services/catalog-service.js",
  "src/http/serializers/product.js",
  "src/services/money.js",
  "tests/unit/money.test.js",
  "src/config.js",
  "src/validation/currency.js",
  "src/http/products-route.js",
  "src/cache/product-cache.js",
  "tests/unit/cache.test.js",
  "src/export/products-csv.js",
  "tests/integration/export.test.js",
  "src/notifications/price-email.js",
  "tests/integration/price-email.test.js",
  "tests/helpers/product-fixture.js",
  "tests/fixtures/products.json",
  "tests/integration/products-route.test.js",
  "tests/unit/catalog-service.test.js"
 ],
 "tickets": [
  {
   "estimate_days": 3,
   "depends_on": [
    "MC-07",
    "MC-06",
    "MC-05",
    "MC-04",
    "MC-03"
   ],
   "files": [
    "tests/unit/catalog-service.test.js"
   ],
   "title": "In short: Verify the complete regional catalog behavior",
   "id": "MC-08"
  },
  {
   "estimate_days": 1,
   "depends_on": [
    "MC-02"
   ],
   "files": [
    "tests/fixtures/products.json",
    "tests/helpers/product-fixture.js"
   ],
   "title": "In short: Make shared product fixtures multi-currency",
   "id": "MC-07"
  },
  {
   "estimate_days": 1,
   "depends_on": [
    "MC-02"
   ],
   "files": [
    "tests/integration/price-email.test.js",
    "src/notifications/price-email.js"
   ],
   "title": "In short: Render currency-aware price notifications",
   "id": "MC-06"
  },
  {
   "estimate_days": 2,
   "depends_on": [
    "MC-02"
   ],
   "files": [
    "tests/integration/export.test.js",
    "src/export/products-csv.js"
   ],
   "title": "In short: Render currency-aware partner CSV prices",
   "id": "MC-05"
  },
  {
   "estimate_days": 2,
   "depends_on": [
    "MC-02"
   ],
   "files": [
    "tests/unit/cache.test.js",
    "src/cache/product-cache.js"
   ],
   "title": "In short: Separate product cache entries by currency",
   "id": "MC-04"
  },
  {
   "estimate_days": 2,
   "depends_on": [
    "MC-02"
   ],
   "files": [
    "tests/integration/products-route.test.js",
    "src/http/products-route.js",
    "src/validation/currency.js"
   ],
   "title": "In short: Validate the currency query and route response",
   "id": "MC-03"
  },
  {
   "estimate_days": 3,
   "depends_on": [
    "MC-01"
   ],
   "files": [
    "src/config.js",
    "tests/unit/money.test.js",
    "src/services/money.js",
    "src/http/serializers/product.js",
    "src/services/catalog-service.js",
    "src/storage/product-repository.js"
   ],
   "title": "In short: Read the requested catalog currency",
   "id": "MC-02"
  },
  {
   "estimate_days": 3,
   "depends_on": [],
   "files": [
    "docs/data-dictionary.md",
    "db/migrations/005_add_product_prices.sql"
   ],
   "title": "In short: Add product price records and USD backfill",
   "id": "MC-01"
  }
 ]
}
```

## Reasoning

- Tests cover the fallback, validation, formatting, cache separation, and shared fixture behavior before release.
- The API, partner CSV, and notification show the same currency and amount for the same product.
- A product cache entry for one currency cannot satisfy another currency's request.
- Omitted currency still returns USD; EUR and GBP return supplied regional amounts; unsupported codes return the normal client error.
- The migration preserves every existing USD amount, has a checked row count, and is safe to apply in the rolling deployment sequence.
The order below is a dependency order. The branches after the catalog read path can overlap, while the integration slice waits for the affected behavior to be complete.
The estimate is summed engineer effort, not elapsed time. From the guide, the eight slices are 3 + 3 + 2 + 2 + 1 + 1 + 2 + 3 workdays. The estimate assumes valid USD, EUR, and GBP rows arrive from the regional feed. It does not include an exchange-rate provider, tax calculation, or a market-selection UI. The repository snapshot has no separate operator API document beyond the request material, so the API contract example should be updated or added alongside the route change during implementation.
The final coverage checks the omitted-currency fallback, supported EUR and GBP values, unsupported input, output formatting, cache isolation, CSV, notification, and compatibility for existing USD callers. A release check should compare one product and currency across all three outputs, verify that every expected backfill row exists, and watch for wrong-currency or missing-price responses. If those checks fail, stop the application rollout and keep the old reader path available.
The cache key must include both product id and currency. Otherwise, a warmed USD product can satisfy a later EUR request. Once the read path is ready, the cache tests, CSV renderer, notification renderer, and shared fixture work can proceed in parallel. Both non-API renderers need to consume the same currency-aware amount and formatting contract as the API. The shared helper currently defaults currency explicitly to USD, so leaving it unchanged would break or distort the broader test suite.
Next, the repository and catalog service read the selected currency, with USD as the fallback. The serializer carries both the selected code and the formatted amount. The route validates the query value and returns the normal client error for unsupported codes. This read contract is the handoff point for the remaining slices.
The first slice creates `product_prices`, preserves the existing `products.price_minor` values as USD rows, and records the new data shape. The migration should be safe to rerun or should fail clearly when already applied, and the rollout should verify row counts and sample amounts. The old USD reader must remain usable during the rolling deployment.
The plan keeps omitted-currency callers on USD, supports USD, EUR, and GBP, and reads supplied regional amounts without calculating exchange rates. It includes the API, cache, partner CSV, notification, validation, shared fixtures, and tests. No change is needed in the unreferenced legacy pricing module.
This is **17 engineer-days of work**. The effort is within the Q2 windows, but 17 engineer-days is not a 17-day promise: after the migration and catalog read path are ready, several slices can run in parallel, so a two-person team could complete the implementation in about 10–12 working days, followed by integration and rollout checks. The 2027-05-21 roadmap target is plausible if the regional feed is available and the team reserves capacity. The database change must land and its USD backfill must be checked before any application instance reads the new shape.
