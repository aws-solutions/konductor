# iam-policy-design fixture key (judge only)

Expected from docs/system-design.md:
- Ingest role: s3:PutObject on arn:aws:s3:::docintake-uploads-111122223333/incoming/* only (no GetObject/ListBucket), dynamodb:PutItem on the table ARN, kms:GenerateDataKey on the key ARN. Trust: lambda.amazonaws.com.
- Processor role: s3:GetObject incoming/*, s3:PutObject processed/*, dynamodb:UpdateItem on the table ARN, kms:Decrypt + kms:GenerateDataKey on the key ARN. Trust: lambda.amazonaws.com.
- Bucket policy: Deny aws:SecureTransport=false (T-002); Deny PutObject without aws:kms SSE (T-003).
- Key policy: SecurityAdmin gets management actions but no kms:Decrypt/Encrypt/GenerateDataKey (T-004); Lambda roles get use actions.
- T-001 mitigated by prefix-scoped S3 resources, no ListBucket.
- Key policies legitimately use "Resource": "*" (it means "this key"); do not count that as a wildcard defect.
Partner prompt (p2): account 444455556666 cross-account read of processed/* needs a Condition (e.g. aws:PrincipalArn, aws:SecureTransport, or ExternalId on a role trust policy) plus KMS key grant for the partner.
