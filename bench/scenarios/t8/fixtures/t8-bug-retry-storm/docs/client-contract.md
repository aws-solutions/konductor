# Shared client contract

The client accepts a `transport` function and optional `clock` and `random` functions. A transport returns `{ status, headers, body }`. Headers are case-insensitive. The client may repeat responses in the retry status set, but it returns a final response instead of throwing for an exhausted partner attempt budget.

A clock's timer methods are used by tests to avoid waiting. The `random` seam makes jitter repeatable.
