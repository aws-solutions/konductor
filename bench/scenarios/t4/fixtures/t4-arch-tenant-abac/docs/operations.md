# Operations

The example deployment uses account `111122223333`, region `us-east-1`, and the resources named in `infra/config/access-config.json`. These values are documentation fixtures, not credentials.

Operators review generated tenant policy files with `node scripts/stamp-tenants.js --check`. The command only compares normalized JSON and does not contact a cloud service.

For an incident, preserve the request id, tenant id, and operation name from the structured log. Do not copy bearer tokens into tickets. The local audit formatter intentionally omits token values.
