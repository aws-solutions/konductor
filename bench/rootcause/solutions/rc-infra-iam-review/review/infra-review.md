# Infrastructure review: orders stack

Inputs: `template.yaml`, `policies/support-role.json`, requirements in `README.md`. The originals are unchanged. A least-privilege replacement for the support policy is in `review/support-role.fixed.json`.

## Findings

| # | Severity | Where | Problem | Requirement broken | Fix |
|---|----------|-------|---------|--------------------|-----|
| 1 | Critical | template.yaml:14 | UploadBucket sets `AccessControl: PublicRead`, so anyone on the internet can read uploads. | Bucket is private | Remove the ACL, add `PublicAccessBlockConfiguration` with all four flags true. |
| 2 | Critical | template.yaml:77 | OpsSecurityGroup opens SSH (port 22) to `0.0.0.0/0`. | Hosts reachable from 10.20.0.0/16 only | `CidrIp: 10.20.0.0/16`. |
| 3 | Critical | template.yaml:45-47 | FunctionRole allows `dynamodb:*` and `s3:*` on `Resource: '*'`. | Orders table and `uploads/` only | Allow `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `Query` on the Orders table ARN and `s3:GetObject`, `s3:PutObject` on `arn:aws:s3:::orders-uploads-example/uploads/*`. |
| 4 | Critical | template.yaml:35-36 | The trust policy of FunctionRole has `Principal: AWS: '*'`: any principal in any account can assume the role. | Least privilege | `Principal: Service: lambda.amazonaws.com`. |
| 5 | Critical | policies/support-role.json:13 and :19 | `s3:*` on `*` and `iam:*` on `*`. The support team could delete every bucket object and create administrators. | Support can read only and cannot manage identities | Replace with the policy in `review/support-role.fixed.json`: read actions on the Orders table and `s3:GetObject` under `uploads/`. |
| 6 | Important | template.yaml:5-7 and :61 | `DbPassword` has a literal default and reaches the function as the `DB_PASSWORD` environment variable in plain text. | No plain-text secrets | Keep the value in Secrets Manager, pass only the secret ARN, remove the default. |
| 7 | Important | template.yaml:90 | The POST method has `AuthorizationType: NONE`. Anyone can create orders. | Every method requires authentication | Use an IAM, Cognito or Lambda authorizer. |
| 8 | Important | template.yaml:10-14 | The bucket has no default encryption and no versioning. | Encrypted at rest | Add `BucketEncryption` (SSE-KMS or SSE-S3) and `VersioningConfiguration: Enabled`. |
| 9 | Important | template.yaml:16-27 | OrdersTable has no point-in-time recovery, no explicit encryption and no `DeletionPolicy`. A stack update that replaces the table deletes the data. | Restorable, protected from accidental deletion | `PointInTimeRecoverySpecification`, `SSESpecification`, `DeletionPolicy: Retain`, `DeletionProtectionEnabled: true`. |
| 10 | Minor | template.yaml:66-67 | OrdersFunctionLogs has no `RetentionInDays`, so logs never expire. | Logs kept 90 days | `RetentionInDays: 90`. |

## Corrected snippets

```yaml
UploadBucket:
  Type: AWS::S3::Bucket
  Properties:
    PublicAccessBlockConfiguration:
      BlockPublicAcls: true
      BlockPublicPolicy: true
      IgnorePublicAcls: true
      RestrictPublicBuckets: true
    BucketEncryption:
      ServerSideEncryptionConfiguration:
        - ServerSideEncryptionByDefault: { SSEAlgorithm: aws:kms }
    VersioningConfiguration: { Status: Enabled }
```

## Notes on the replacement support policy

It grants GetItem, Query and BatchGetItem on the one table, GetObject on `uploads/*` and ListBucket restricted to that prefix. `Scan` is left out: with a key schema of `orderId` only, support can look orders up by id. If support needs a full listing, add a global secondary index instead of `Scan`.

## Summary

Five critical findings, four important, one minor. The public bucket, world-open SSH and the two wildcard permission sets should be fixed before any deployment.
