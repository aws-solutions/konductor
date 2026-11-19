# Data model

A plan has a monthly price in cents. An invoice has a customer id, a cycle, line items, a total, and a status. Ledger entries are append-only and have a reference supplied by the caller.

Calendar dates are parsed in UTC. A change on the cycle boundary starts a new full-cycle charge; a change before that boundary gets a credit for unused time.
