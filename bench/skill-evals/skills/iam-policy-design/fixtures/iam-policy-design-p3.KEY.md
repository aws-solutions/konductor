# iam-policy-design-p3 fixture key (judge only)

drafts/ holds a teammate's policies for DocIntake (docs/ is the same design and threat model as fixtures/iam-policy-design/). Planted defects and expected severities under the skill's quality gate:
- CRITICAL: processor-role.json `ProcessorS3` uses `s3:*` on the whole bucket (wildcard action on S3). Expected: s3:GetObject on incoming/* and s3:PutObject on processed/* only. Also lets the processor delete objects and change nothing else needed.
- CRITICAL: kms-key-policy.json `KeyAdministration` gives SecurityAdmin `kms:*`, which includes Decrypt; breaks T-004 (admin must manage, not use). Expected: management actions only (Create*, Describe*, Enable*, List*, Put*, Update*, Revoke*, Disable*, Get*, Delete*, TagResource, UntagResource, ScheduleKeyDeletion, CancelKeyDeletion).
- CRITICAL: uploads-bucket-policy.json `PartnerReadProcessed` grants account 444455556666 (whole account root) with no Condition. Also, the partner needs kms:Decrypt on the key, which the key policy does not grant, so the grant would not even work for SSE-KMS objects.
- IMPORTANT: bucket policy has no `aws:SecureTransport` deny (T-002 unmitigated).
- IMPORTANT: ingest-role.json grants `dynamodb:Scan`, broader than the documented access pattern (PutItem only); a compromised ingest function could read every job item (other customers' metadata), which touches T-001.
- LambdaUse in the key policy grants kms:Decrypt to the ingest role too; ingest only needs GenerateDataKey. Broader than access pattern (IMPORTANT).
Correct, should NOT be flagged as defects: `"Resource": "*"` inside the KMS key policy (means this key); the AccountRoot statement with kms:* (standard key-policy root delegation that keeps the key manageable; flagging it as a wildcard defect is a false positive, though noting it delegates to IAM is fine); ingest PutObject scoped to incoming/*; processor dynamodb:UpdateItem only.
Missing artifacts: no trust policies in drafts (each role needs lambda.amazonaws.com trust); worth an IMPORTANT/SUGGESTION.
