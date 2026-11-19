# Platform limits

The key-value service assigns write capacity in write capacity units (WCU). A storage partition accepts no more than 1,000 WCU per second. This is a service ceiling, not a target to exceed temporarily. A logical key that remains hot must be spread across write-distribution shards before it reaches the storage partition allocator.

The relational alternative is evaluated against its cluster capacity rather than this key-value partition ceiling. The chosen record should still show how the launch-day hot set is handled so that the comparison is auditable.
