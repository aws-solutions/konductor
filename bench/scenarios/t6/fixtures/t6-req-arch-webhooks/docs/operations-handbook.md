# Operations handbook excerpt

On-call can pause a worker pool and inspect outbox lag. A delivery integration should expose enough information to distinguish a customer endpoint outage from an internal queue problem. Alert rules should avoid paging on one transient remote error.

Incident records must include the account, integration, provider request identifier, response class, and timestamps. Do not copy request bodies into tickets unless the security reviewer approves the data handling.
