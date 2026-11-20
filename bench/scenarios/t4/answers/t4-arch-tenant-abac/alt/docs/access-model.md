# Access model

Tenants share one IAM role and one identity policy. The tenant's identity reaches IAM as two session tags, and the policy uses those tags to scope every storage call. This replaces the roughly 40 generated per-tenant role policies, so the number of roles no longer grows with the number of tenants.

Files:

| File | Attached to | Purpose |
| --- | --- | --- |
| `infra/shared/tenant-access-policy.json` | The single shared tenant role | Tenant document and metadata access |
| `infra/shared/support-policy.json` | `role/support-readonly` (`supportPrincipal` in `infra/config/access-config.json`) | Read-only metadata for support staff |

Both are identity policies (no `Principal` element). Resource names and the account come from `infra/config/access-config.json`. The bucket, table and account are unchanged.

## Why session tags

| Option | Result |
| --- | --- |
| One role per tenant (previous model) | Simple to read, but hits the account role limit and needs a generator run for every new tenant. |
| One shared role, one policy statement per tenant | Removes the roles, but the policy grows with tenant count and hits the policy size limit. |
| One shared role, scoped by session tags (chosen) | Policy size and role count are constant. A new tenant needs no infrastructure change. |

With the chosen model the isolation depends on the tag values, so the tags must be trustworthy. That is the main thing the code has to keep true (below).

## Session tags

The service assumes the shared role once per tenant and tier, passing these tags:

| Tag | Value | Used for |
| --- | --- | --- |
| `tenant` | The tenant id from the verified token, matching `^[a-z0-9-]{3,64}$` | Object prefix, list prefix, metadata partition key |
| `tier` | `premium` or `standard` from the verified token | Export writes (`premium` only) |

Policies read them as `aws:PrincipalTag/tenant` and `aws:PrincipalTag/tier`. The shared role must not carry its own `tenant` or `tier` tag. If it did, the role tag could mask a missing session tag and defeat the missing-tag refusal.

The trust policy of the shared role is not part of these files. It must allow `sts:AssumeRole` and `sts:TagSession` only for the service's own execution role. Without that, any caller who can assume the role can choose its own tenant tag.

## What the tenant policy enforces

Allows, all scoped to the caller's tag:

- `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `tenants/<tenant>/*`.
- `s3:ListBucket` only when the request prefix is `tenants/<tenant>/...`. A list with no prefix does not match and is refused.
- `s3:PutObject` on `exports/<tenant>/*` when `tier` is `premium`. Exports are write-only for tenants: there is no read, list or delete on `exports/`.
- DynamoDB `GetItem`, `BatchGetItem`, `Query`, `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem` on the metadata table, only when every partition key in the request equals the tenant tag (`dynamodb:LeadingKeys`). The `Null` condition makes a request with no leading key fail, because `ForAllValues` alone passes on an empty set. This means `Scan` is refused. Indexes are not granted to tenants.

Explicit denies, which win over any other allow attached to the role or granted by a bucket or table policy:

- `DenyMissingTenantTag`: every action on every resource when the `tenant` tag is absent.
- `DenyUnsafeTenantTagValue`: every action when the tag is empty or contains `*`, `?` or `/`. This guards against a value that could widen a resource pattern. It is a second line behind the id check in `src/request-context.js`.
- `DenyObjectsOutsideOwnPrefixes`: S3 actions on any object other than `tenants/<tenant>/*` and `exports/<tenant>/*`. Because it is written with `NotResource`, this role is also refused on every other bucket. That is intended for a role that exists only for this service.
- `DenyListingOutsideOwnPrefix`: `s3:ListBucket` unless the prefix is the tenant's own.
- `DenyOtherTenantMetadata`: any DynamoDB action on the table or its indexes where a leading key differs from the tenant tag.

A tenant that guesses another tenant's id gets a different key, so the prefix match, the leading-key match and the explicit denies all fail.

## What the support policy enforces

Support staff get `GetItem`, `BatchGetItem` and `Query` on any partition of the metadata table and its indexes. The allow is bound to `aws:PrincipalArn` equal to the support role, so attaching the file to another role grants nothing.

Two explicit denies apply regardless of other policies:

- `DenySupportDocumentAccess`: every `s3:*` action on the bucket and its objects.
- `DenySupportMetadataWrites`: `PutItem`, `UpdateItem`, `DeleteItem`, `BatchWriteItem` and the PartiQL insert, update and delete actions on the table and its indexes.

`Scan` is not granted. Support finds a tenant by id with `Query`. Add `dynamodb:Scan` to the allow if listing all tenants is needed.

## What the code must keep true

1. **Tags come only from the verified token.** `tenant` and `tier` must be set from the authentication adapter's verified claims, never from the request body, headers or query. `createRequestContext` already restricts the tenant id to `^[a-z0-9-]{3,64}$`; any other path that sets tags must apply the same check.
2. **One credential set per tenant and tier.** Never cache or reuse assumed-role credentials across tenants. Key any credential cache by tenant and tier. A tier change takes effect on the next assumption, so keep session durations short.
3. **Keys use the context's tenant.** Build object keys with `documentKey`, `exportKey` and `metadataKey` from `src/storage-path.js`, using `context.tenantId`. Do not accept a tenant id or key prefix from the caller.
4. **Metadata partition key is the tenant id.** The table's partition key value must be the tenant id exactly, as `metadataKey` returns. The policy compares the partition key value, so a different scheme (composite keys, prefixes) would be denied.
5. **List with a prefix.** Always call `ListObjectsV2` with the `tenants/<tenant>/` prefix. Read metadata with `GetItem` or `Query` on the tenant's partition. Do not use `Scan` or secondary indexes on the tenant path.
6. **Tier handling.** `prepareExport` checks the premium tier in code, and IAM checks the `tier` tag as well. Both must come from the same token claim. A missing or unknown tier is `standard`, which has no export write.
7. **No cross-tenant work through the tenant role.** Background jobs, cleanup and migrations that touch several tenants need their own role. Do not loosen the tenant policy for them.
8. **Do not attach other policies to the shared role that depend on the tenant tag being optional.** The explicit denies make the role unusable without a valid tag.

## Rollout

1. Create the shared role with the trust policy described above and attach `tenant-access-policy.json`.
2. Attach `support-policy.json` to `support-readonly`. Remove any existing broader policy on that role, such as the previous wildcard policy, so the intent is visible. The denies hold either way.
3. Switch the service to assume the shared role with session tags.
4. Verify with the IAM policy simulator or a test tenant: own prefix allowed, another tenant's prefix refused, no tag refused, standard export write refused, support document read refused.
5. Delete the per-tenant roles. The files in `infra/tenants/`, `config/tenants.json` and `scripts/stamp-tenants.js` are left in place for comparison until the old roles are gone.

## Limits

- The policies cover the actions the service uses today. Versioned-object actions (`s3:GetObjectVersion`, `s3:DeleteObjectVersion`), `s3:AbortMultipartUpload` and `s3:ListBucketMultipartUploads` are not granted. Documents are limited to 10 MB, so single `PutObject` calls are enough. Add them, scoped the same way, if the bucket becomes versioned or multipart uploads are introduced.
- The files were checked as JSON and by review. They have not been evaluated against a live account.
