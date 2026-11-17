# Changelog

## Unreleased

- Lookups are cached for 60 s (at most 1000 items, least recently used dropped), and lookups of one SKU at once
  share one supplier call.
- At most 4 supplier calls run at once; `BUSY` and `TIMEOUT` are retried 3 times in all, then the call fails with
  `SUPPLIER_UNAVAILABLE`.
- `listByCategory` answers from an index built once from the snapshot.
- Supplier records are translated in one place, `src/supplier/translate.js`. `priceLabel` uses the cached lookup.

## 0.6.0

- `priceLabel(sku)`.

## 0.5.0

- Category listing from the nightly snapshot.
