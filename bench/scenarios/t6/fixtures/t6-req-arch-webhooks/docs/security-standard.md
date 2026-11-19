# Integration security standard excerpt

External integrations must use TLS and must not disable certificate validation. Requests carrying account data must be authenticated and must include a replay-resistant integrity check. The receiving party needs a way to rotate credentials without an outage.

Secrets belong in the managed secret store. Never put credentials, bearer tokens, full payment card numbers, or security codes in logs. Security review is required before enabling a new external integration in production.

The standard does not prescribe one webhook signature format or the lifetime of old credentials during rotation.
