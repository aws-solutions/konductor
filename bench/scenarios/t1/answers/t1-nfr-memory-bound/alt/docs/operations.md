# Operations

The worker is stateless between process restarts apart from the delivery de-duplication table. Keep the process behind the service's normal request timeout and send logs to standard output.

Health checks should call `node scripts/healthcheck.js`. A non-zero exit means the runtime is not supported.

## De-duplication Store

The in-memory de-duplication store is bounded to prevent unbounded memory growth during long-running deployments:

- **Capacity**: Stores at most 3 unique delivery keys.
- **Expiry**: Keys expire after 60,000 ms (60 seconds).
- **Eviction**: When at capacity, the oldest key is evicted to make room.
- **Normalization**: Keys are trimmed of whitespace and compared case-insensitively.

The `stats()` method on the store returns:
- `remembered`: Current number of keys in the store.
- `max`: Maximum capacity (3).
- `windowMs`: Expiry window in milliseconds (60,000).
- `evictions`: Count of keys removed due to capacity.
- `expirations`: Count of keys removed due to expiry.
