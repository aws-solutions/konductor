# catalog-gateway design

## Problem

Product pages call `lookup` for every item they show. Each call goes to the supplier's legacy item service, which
is slow (about 300 ms), allows few calls at once and fails now and then with `BUSY` or `TIMEOUT`. The category page
filters the whole snapshot (10,000 items) on every request. The supplier's record format leaks into every module.

## Targets

| id | target | mechanism |
|---|---|---|
| NFR-1 | A SKU looked up again within 60 s costs no supplier call. Lookups of one SKU that run at once share one call. | Cache of domain items, TTL 60 s, at most 1000 entries, least recently used entry dropped when full. |
| NFR-2 | Never more than 4 supplier calls in flight from one service. | Concurrency limit of 4; further calls wait in a queue in arrival order. |
| NFR-3 | A `BUSY` or `TIMEOUT` from the supplier does not reach the caller unless it repeats. | Retry: at most 3 attempts in all, waiting 50 ms then 100 ms between them. Other errors are not retried. After the last attempt the call rejects with code `SUPPLIER_UNAVAILABLE`, naming the last supplier code in its message. |
| NFR-4 | `listByCategory` does not scan the snapshot per call. | Index by category, built once from `items` when the service is created. |

The numbers are in `config/service.json`. `NOT_FOUND` means the SKU does not exist: `lookup` resolves to `null` and
nothing is cached for it.

## Supplier boundary

The supplier's format (`docs/SUPPLIER-API.md`) is not ours and changes between supplier releases. Translation
to the domain item `{ sku, name, priceCents, active, category }` happens in one place, an anti-corruption layer.
No other module reads a supplier field name. `priceCents` is a number, `active` is a boolean.

## Not in scope

Sharing the cache between processes, invalidation on supplier price changes, and persistence.
