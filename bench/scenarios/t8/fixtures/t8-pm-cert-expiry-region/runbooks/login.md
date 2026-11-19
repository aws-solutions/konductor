# Login service response

Check the regional success-rate and TLS panels before changing global routing. Compare edge, gateway, and
auth-service request IDs. Keep a timestamped note for every routing change.

A rollback is appropriate when a release explains the first failing requests and the failure is present in
both the request and health-check paths. Otherwise preserve the logs and inspect the shared dependencies.
