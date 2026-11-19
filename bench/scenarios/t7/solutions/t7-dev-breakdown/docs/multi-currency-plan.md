# Multi-currency prices plan

## Bottom line

This is **17 engineer-days of work**. The effort is within the Q2 windows, but 17 engineer-days is not a 17-day promise: after the migration and catalog read path are ready, several slices can run in parallel, so a two-person team could complete the implementation in about 10–12 working days, followed by integration and rollout checks. The 2027-05-21 roadmap target is plausible if the regional feed is available and the team reserves capacity. The database change must land and its USD backfill must be checked before any application instance reads the new shape.

The plan keeps omitted-currency callers on USD, supports USD, EUR, and GBP, and reads supplied regional amounts without calculating exchange rates. It includes the API, cache, partner CSV, notification, validation, shared fixtures, and tests. No change is needed in the unreferenced legacy pricing module.

## Sequence and reasoning

The first slice creates `product_prices`, preserves the existing `products.price_minor` values as USD rows, and records the new data shape. The migration should be safe to rerun or should fail clearly when already applied, and the rollout should verify row counts and sample amounts. The old USD reader must remain usable during the rolling deployment.

Next, the repository and catalog service read the selected currency, with USD as the fallback. The serializer carries both the selected code and the formatted amount. The route validates the query value and returns the normal client error for unsupported codes. This read contract is the handoff point for the remaining slices.

The cache key must include both product id and currency. Otherwise, a warmed USD product can satisfy a later EUR request. Once the read path is ready, the cache tests, CSV renderer, notification renderer, and shared fixture work can proceed in parallel. Both non-API renderers need to consume the same currency-aware amount and formatting contract as the API. The shared helper currently defaults currency explicitly to USD, so leaving it unchanged would break or distort the broader test suite.

The final coverage checks the omitted-currency fallback, supported EUR and GBP values, unsupported input, output formatting, cache isolation, CSV, notification, and compatibility for existing USD callers. A release check should compare one product and currency across all three outputs, verify that every expected backfill row exists, and watch for wrong-currency or missing-price responses. If those checks fail, stop the application rollout and keep the old reader path available.

The estimate is summed engineer effort, not elapsed time. From the guide, the eight slices are 3 + 3 + 2 + 2 + 1 + 1 + 2 + 3 workdays. The estimate assumes valid USD, EUR, and GBP rows arrive from the regional feed. It does not include an exchange-rate provider, tax calculation, or a market-selection UI. The repository snapshot has no separate operator API document beyond the request material, so the API contract example should be updated or added alongside the route change during implementation.

## Pick-up order

The order below is a dependency order. The branches after the catalog read path can overlap, while the integration slice waits for the affected behavior to be complete.

```breakdown
{
  "tickets": [
    {
      "id": "MC-01",
      "title": "Add product price records and USD backfill",
      "files": ["db/migrations/005_add_product_prices.sql", "docs/data-dictionary.md"],
      "depends_on": [],
      "estimate_days": 3
    },
    {
      "id": "MC-02",
      "title": "Read the requested catalog currency",
      "files": ["src/storage/product-repository.js", "src/services/catalog-service.js", "src/http/serializers/product.js", "src/services/money.js", "tests/unit/money.test.js", "src/config.js"],
      "depends_on": ["MC-01"],
      "estimate_days": 3
    },
    {
      "id": "MC-03",
      "title": "Validate the currency query and route response",
      "files": ["src/validation/currency.js", "src/http/products-route.js", "tests/integration/products-route.test.js"],
      "depends_on": ["MC-02"],
      "estimate_days": 2
    },
    {
      "id": "MC-04",
      "title": "Separate product cache entries by currency",
      "files": ["src/cache/product-cache.js", "tests/unit/cache.test.js"],
      "depends_on": ["MC-02"],
      "estimate_days": 2
    },
    {
      "id": "MC-05",
      "title": "Render currency-aware partner CSV prices",
      "files": ["src/export/products-csv.js", "tests/integration/export.test.js"],
      "depends_on": ["MC-02"],
      "estimate_days": 2
    },
    {
      "id": "MC-06",
      "title": "Render currency-aware price notifications",
      "files": ["src/notifications/price-email.js", "tests/integration/price-email.test.js"],
      "depends_on": ["MC-02"],
      "estimate_days": 1
    },
    {
      "id": "MC-07",
      "title": "Make shared product fixtures multi-currency",
      "files": ["tests/helpers/product-fixture.js", "tests/fixtures/products.json"],
      "depends_on": ["MC-02"],
      "estimate_days": 1
    },
    {
      "id": "MC-08",
      "title": "Verify the complete regional catalog behavior",
      "files": ["tests/unit/catalog-service.test.js"],
      "depends_on": ["MC-03", "MC-04", "MC-05", "MC-06", "MC-07"],
      "estimate_days": 3
    }
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
  "files_to_change": [
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
  "total_estimate_days": 17
}
```

## Completion conditions

- The migration preserves every existing USD amount, has a checked row count, and is safe to apply in the rolling deployment sequence.
- Omitted currency still returns USD; EUR and GBP return supplied regional amounts; unsupported codes return the normal client error.
- A product cache entry for one currency cannot satisfy another currency's request.
- The API, partner CSV, and notification show the same currency and amount for the same product.
- Tests cover the fallback, validation, formatting, cache separation, and shared fixture behavior before release.
