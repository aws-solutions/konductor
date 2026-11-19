# Incident summary: provider timeout and duplicate authorization

Date: 2024-11-18
Duration: 27 minutes of elevated support contacts
Severity: SEV-2

A payment provider accepted an authorization request but its response timed out at our edge. The checkout worker retried after 2 seconds. The provider accepted the retry as a second authorization because the request carried a locally unique attempt ID rather than a provider idempotency key. Thirty-seven customers saw two pending authorizations; reconciliation cleared them later that day.

The immediate mitigation was to disable automatic retries for that provider and have support void duplicate authorizations. The incident review required a stable idempotency key to follow a checkout operation across retries, plus a durable record of the provider request before retrying. The provider contract supports an idempotency key with a 24-hour retention window.

The monolith currently returns the original checkout result when a checkout token is replayed. A timeout before the result reaches the caller is treated as an unknown outcome and is reconciled by the checkout worker.
