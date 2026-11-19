# Cache gateway operations

Cache nodes are cache-1, cache-2, and cache-3. Product responses use the `products` and `categories` key groups. A policy reload warms the current catalogue before the node returns healthy.

Normal observations include small refreshes, occasional evictions, and short replication lag. A warmup should be monitored for queue depth and completion time. If a node reports backpressure, check the refill queue before increasing database capacity.

The policy file is reviewed with the release record. Keep expiration behavior consistent across nodes and record any manual policy change in the incident channel.
