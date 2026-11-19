# Checkout latency response notes

Use the checkout dashboard and the pooler dashboard together. Compare p50 and p99 latency with `five_xx` and `pool_waiters`; a p99-only change can be a small number of slow requests, while a rising waiter count means callers are waiting for a client slot.

For an active checkout incident:

1. Confirm the timestamp range in UTC and check whether payments and inventory show the same symptom.
2. Record the request rate, p99, 5xx count, and waiter count before taking action.
3. Inspect the pooler log for queue depth, acquisition timeouts, and recent administrative changes.
4. Use the approved last-known-good pooler operation only after capturing evidence. Record the operator, exact time, and resulting pool state.
5. Watch for a zero waiter count and normal p99 for at least ten minutes before closing the incident.

Do not treat a passing health endpoint or a recent application release as proof of causality without matching request-path evidence.
