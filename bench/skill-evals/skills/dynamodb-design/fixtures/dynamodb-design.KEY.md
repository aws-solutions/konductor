# dynamodb-design fixture key (docs/access-patterns.md)

Discriminators the skill specifically drives:
- AP4 and AP5 must not be served by Scan. AP4: sparse GSI keyed only on pending items (or status+createdAt with sharding). AP5: GSI with constant/type key is acceptable only below ~1,000 writes/s; peaks are 1,200 writes/s, so a sharded list key or per-status iteration is the right call.
- Status must not be a base-table or high-traffic GSI partition key (low cardinality).
- TTL for unpaid pending bookings (24h). PITR enabled (accidental-delete recovery).
- Capacity: 1.5 KB items => 2 WCU per write; numbers must be labeled as estimates.
