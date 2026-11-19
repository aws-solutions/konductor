# Review

Request changes before merge. The cache path has correctness problems that affect tenant isolation and price freshness, and it does not yet meet the behavior promised by `docs/caching.md`. The default profile enables the cache, so these are production-path issues rather than dormant code.

The most serious issue is the cache key in `PriceService`: the tenant is available at the call boundary but is discarded before lookup. A northwind hit can therefore satisfy a southridge request for the same list id. The bulk replacement path has the opposite invalidation gap: single updates clear the list, while the nightly replacement leaves the old list in place.

The wiring also passes `ttlSeconds` to a setter whose contract is milliseconds. The effective lifetime is roughly 30 milliseconds for the default configuration. Under the documented burst traffic, each simultaneous miss reads the store independently because the loader has no pending-promise registry. Finally, `PriceCache.get` exposes the stored array/object and `set` never enforces `maxEntries`; callers can mutate shared cached state and the process can retain unbounded entries.

Findings:

- **Critical, `src/services/price-service.mjs:11`**: The key contains only `listId`. Include the tenant id in a composite key, and use that same key for reads and invalidation.
- **High, `src/services/price-service.mjs:24`**: `replace` writes without invalidating the corresponding cached list. Invalidate after a successful bulk replacement.
- **Medium, `src/app.mjs:22`**: Configuration is in seconds but the cache setter takes milliseconds. Convert the value at the boundary, preferably by multiplying seconds by 1000 or changing the option contract consistently.
- **Medium, `src/services/price-service.mjs:28`**: The direct store loader does not share an in-flight promise. Track pending loads by cache key and have concurrent misses await the same promise.
- **High, `src/cache/price-cache.mjs:26`**: Returning `entry.value` exposes cached mutable data. Return a defensive copy and store a copy when appropriate.
- **Medium, `src/cache/price-cache.mjs:29`**: `maxEntries` is never applied. Evict an entry when inserting beyond the configured limit, or use a bounded map implementation.

```json
[
  {
    "location": "src/services/price-service.mjs:11",
    "severity": "critical",
    "issue": "The cache key uses only the price-list id, allowing one tenant to receive another tenant's cached prices.",
    "fix": "Include the tenant id in a composite, tenant-scoped key and use it consistently for invalidation."
  },
  {
    "location": "src/services/price-service.mjs:24",
    "severity": "high",
    "issue": "Bulk replacement writes new prices but leaves the old list in the cache, so imports do not become visible to readers.",
    "fix": "Invalidate the corresponding cache entry after a successful bulk replace."
  },
  {
    "location": "src/app.mjs:22",
    "severity": "medium",
    "issue": "The configured TTL is in seconds but is passed to a cache setter that interprets it as milliseconds, reducing 30 seconds to about 30 milliseconds.",
    "fix": "Convert seconds to milliseconds at the application boundary by multiplying by 1000."
  },
  {
    "location": "src/services/price-service.mjs:28",
    "severity": "medium",
    "issue": "Concurrent misses all call the JSON store independently because no in-flight load is shared.",
    "fix": "Track pending loads by key and deduplicate concurrent misses with the same in-flight promise."
  },
  {
    "location": "src/cache/price-cache.mjs:26",
    "severity": "high",
    "issue": "A hit returns the cached mutable value by reference, so a caller can change subsequent responses without writing the store.",
    "fix": "Return a defensive clone and avoid exposing the cached object directly."
  },
  {
    "location": "src/cache/price-cache.mjs:29",
    "severity": "medium",
    "issue": "The cache records maxEntries but set never evicts entries, so memory usage can grow beyond the configured limit.",
    "fix": "Enforce maxEntries by evicting an entry before or during insertion."
  }
]
```