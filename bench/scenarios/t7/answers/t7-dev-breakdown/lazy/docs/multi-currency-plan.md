# Update

I went through the exports. The plan mostly holds; the main items are below.

```breakdown
{
 "tickets": [
  {
   "id": "MC-01",
   "title": "Add product price records and USD backfill",
   "files": [
    "db/migrations/005_add_product_prices.sql"
   ],
   "depends_on": [],
   "estimate_days": 2
  },
  {
   "id": "MC-02",
   "title": "Read the requested catalog currency",
   "files": [
    "src/storage/product-repository.js",
    "src/services/catalog-service.js",
    "src/http/serializers/product.js"
   ],
   "depends_on": [
    "MC-01"
   ],
   "estimate_days": 2
  },
  {
   "id": "MC-03",
   "title": "Validate the currency query and route response",
   "files": [
    "src/validation/currency.js",
    "src/http/products-route.js"
   ],
   "depends_on": [
    "MC-02"
   ],
   "estimate_days": 1
  },
  {
   "id": "MC-04",
   "title": "Separate product cache entries by currency",
   "files": [
    "src/cache/product-cache.js"
   ],
   "depends_on": [
    "MC-02"
   ],
   "estimate_days": 1
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
  "src/http/products-route.js"
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
  "src/http/products-route.js"
 ],
 "total_estimate_days": 12
}
```
