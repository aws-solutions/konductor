# Enable a read-through cache for price lists

The price endpoint is read much more often than the nightly importer writes it. This change adds a small process-local cache so repeated reads avoid parsing the same JSON file. The cache can be enabled per profile, with a lifetime and entry ceiling in configuration. Price writes are wired to the cache lifecycle.

The implementation keeps the repository as the source of truth and leaves the existing routes unchanged. Cache lifecycle tests cover hits, expiry, replacement, clearing, and the configured limit. I ran `npm test` and `npm run check:data` on Node 24.
