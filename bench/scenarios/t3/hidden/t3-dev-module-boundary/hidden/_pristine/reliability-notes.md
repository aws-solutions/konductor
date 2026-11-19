# Recovery notes

Webhook retry state is rebuilt from the service's ingress journal when needed. For this change, the recovery point objective is five minutes or less and the recovery time objective is thirty minutes or less. The existing database backup cadence is fifteen minutes, while the application can replay the journal continuously during recovery.

These targets apply to the production delivery service. A local development compose file uses a one-hour restart window and is not a production requirement.
