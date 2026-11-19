# Notes from the November 2024 database failover

These are operator notes, not a current procedure. The event was used to review handoffs and client recovery.

At 2024-11-02T04:16:00Z the team promoted orders-db-b. The DNS record was changed before the old database had a revoked lease. When orders-db-a returned, it accepted writes for 41 seconds while some clients still had the old address cached. The team stopped orders-db-a and checked order identifiers before reopening traffic.

The follow-up asked for an explicit fence step, a lease check, and a write-path test after client routing changes. Do not reuse the old timing or assume that a recovered process is safe to serve.

The delayed copy in zone-green was retained for backup recovery and was not used as a normal traffic target.
