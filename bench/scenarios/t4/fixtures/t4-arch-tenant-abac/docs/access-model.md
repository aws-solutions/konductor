# Current access notes

The service currently uses generated tenant-specific role policies. The generator and its input catalog are kept in `scripts/` and `infra/tenants/` so operators can compare a deployment with its source data.

The API receives an already verified request context from the authentication adapter. Storage calls use the bucket and table in `infra/config/access-config.json`.
