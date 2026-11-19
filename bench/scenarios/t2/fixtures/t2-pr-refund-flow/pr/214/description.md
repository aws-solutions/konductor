# Add partial and full refunds

This change adds merchant refunds for captured orders. A merchant can submit a
full or partial amount through the new HTTP endpoint, the service records a
refund ledger entry, and the webhook queue receives `refund.created`.

The flow keeps the existing in-memory interfaces and uses the order's captured
balance when checking the requested amount. It also adds a small money helper
and the entry type needed by the ledger.

I tested the full refund path with `node --test`. The existing capture,
ledger, payout, and job tests continue to pass.
