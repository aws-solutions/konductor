# Shared access model

The service uses attribute-based access control with one shared tenant policy instead of one role policy per tenant. The policy puts the tenant identifier into the S3 object ARN and checks the same identifier against DynamoDB `LeadingKeys`. This keeps each tenant inside its own `tenants/<tenant-id>/` object prefix and its own metadata partition while avoiding a role for every tenant.

## Exports and support: notes

A premium session may put objects only below `exports/<tenant-id>/`. The shared tenant policy does not grant export reads or access to another tenant's export prefix. Standard sessions receive no export write grant.

The support policy names the support role in `infra/config/access-config.json`. It grants only `GetItem` and `Query` on the shared metadata table. It explicitly denies S3 access and metadata writes, so support personnel cannot read document objects or change metadata.

The bucket and table ARNs are kept in the deployment configuration. Any code change that introduces a new storage operation must preserve the tenant tag, the matching object prefix or leading key, and the support read-only boundary.

## Session tags: notes

The API must obtain these values from the verified token and pass them as STS session tags:

* `tenant`: the canonical tenant id. It is required for every tenant data request.
* `tier`: the tenant plan, such as `standard` or `premium`. `premium` is required for export writes.

The tags must be set by the trusted token-to-session path, not copied from a request path, query string, or client-provided header. The session used for storage calls must retain them. The code must reject a missing or malformed `tenant` tag before making a request. It must also keep the token tenant, object prefix, and DynamoDB partition key aligned.

The policy explicitly denies S3 and metadata access when `tenant` is absent. Its S3 listing condition uses `ForAllValues:StringLike` so a request containing an allowed prefix and another tenant prefix does not pass. The metadata condition uses `ForAllValues:StringEquals` for `dynamodb:LeadingKeys` and requires that key to be present.
