# Price lookup cache

Price list reads use a process-local read-through cache. It is enabled in the default profile and disabled by setting `priceCache.enabled` to false. The cache is an optimization only; JSON files remain the source of truth.

## Configuration

`priceCache.ttlSeconds` controls how long a price list may be served without reading its file. `priceCache.maxEntries` sets the intended working size for cached lists. The default is 30 seconds and 500 lists.

## Operations

The cache lives inside the API process and starts empty after a restart. It is safe to clear during maintenance because the next request reads from the JSON store. The service continues to work when caching is disabled, which is useful when reproducing a pricing issue locally.
