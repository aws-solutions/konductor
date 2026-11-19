# Cache notes

The cache is local to one process. Entries expire after the configured TTL, and a periodic sweep removes entries that have expired without waiting for a reader.

`maxSize` limits the sum of entry weights. The default weight is one per value. Callers that store larger objects can provide a `sizeCalculation` function when constructing the cache. Replacing a key replaces both its value and its contribution to the weight limit.

Replacing a key starts its TTL again. The sweep examines entries directly, so background cleanup does not count as a hit or miss. A read of an expired entry is a miss. Call `close()` when a long-running cache is no longer needed.
