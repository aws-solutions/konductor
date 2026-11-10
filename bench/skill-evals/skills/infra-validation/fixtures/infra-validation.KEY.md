# infra-validation fixture key
lib/data-stack.ts
- L15 publicReadAccess true (+ L16 only BLOCK_ACLS); no bucket encryption/versioning/access logs: CRITICAL
- L20 partition key 'status' low cardinality (hot partition); no PITR; L23 RemovalPolicy.DESTROY on prod table
- L28 SSH 22 from 0.0.0.0/0: CRITICAL
- L35-36 3008 MB / 15 min without justification; no DLQ, no alarms, no tracing, no log retention
- L39 hardcoded DB_PASSWORD in Lambda env: CRITICAL
- L45-46 actions ['*'] resources ['*']: CRITICAL
cfn/db-template.yaml
- L15 hardcoded MasterUserPassword; L16 StorageEncrypted false; L17 PubliclyAccessible true; L18 MultiAZ false; L19 BackupRetentionPeriod 0; L20 DeletionProtection false; db.r6g.4xlarge oversized
- L36-37 s3:* on *; Lambda no DLQ; Timeout 900; L49 log group with no RetentionInDays
- p3: no environment given; skill requires asking for type/path/environment first.
v2 notes
- S3 has applied SSE-S3 default encryption to new buckets since January 2023, so "unencrypted bucket" is imprecise; a strong answer says encryption is not explicitly configured (no KMS key, no enforce-SSL policy) rather than "data stored in plaintext". Not penalized either way.
- nodejs20.x: Node.js 20 reached upstream end of life in April 2026; Lambda deprecation of nodejs20.x follows that schedule. Flagging the runtime as deprecated or near deprecation is a valid bonus finding (verify against current Lambda runtime docs); not required.
- p3: both lib/ (CDK TypeScript) and cfn/ (CloudFormation YAML) exist, so the type and path are discoverable; the missing item is the environment. A strong question set notes what it found and asks which stack(s) and which environment.
