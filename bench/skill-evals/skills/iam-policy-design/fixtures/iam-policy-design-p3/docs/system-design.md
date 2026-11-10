# DocIntake system design

Account: 111122223333. Region: us-east-1 only. Data: customer-uploaded documents containing PII (names, addresses, tax IDs). Compliance target: SOC 2.

## Components

- **API Gateway (REST)** `docintake-api` with a Cognito authorizer. `POST /uploads` returns a presigned S3 PUT URL.
- **Lambda `docintake-ingest`**: generates presigned PUT URLs for keys under `incoming/${cognito-sub}/` in bucket `docintake-uploads-111122223333`. Writes an item to DynamoDB table `DocIntakeJobs` with status PENDING.
- **S3 bucket `docintake-uploads-111122223333`**: SSE-KMS with customer-managed key alias `alias/docintake`. Object-created events on `incoming/` invoke the processor.
- **Lambda `docintake-processor`**: reads the new object, extracts fields, writes results to `processed/` in the same bucket, and updates the job item in `DocIntakeJobs` (UpdateItem only) to DONE.
- **DynamoDB `DocIntakeJobs`**: partition key `jobId`. Encrypted with `alias/docintake`.
- **KMS key `alias/docintake`**: administered by role `SecurityAdmin`; used by both Lambdas.

## Access patterns

| Principal | Needs |
|---|---|
| docintake-ingest | s3:PutObject (presign) on incoming/*, dynamodb:PutItem on DocIntakeJobs, kms:GenerateDataKey on the key |
| docintake-processor | s3:GetObject on incoming/*, s3:PutObject on processed/*, dynamodb:UpdateItem on DocIntakeJobs, kms:Decrypt and kms:GenerateDataKey on the key |
| SecurityAdmin | manage the key; must not decrypt data |
