# Key: policy-validation fixture
- lambda-role-policy.json Statement "Uploads": s3:* on * (wildcard action + resource) -> CRITICAL.
- vendor-trust-policy.json: cross-account trust to 444455556666 without sts:ExternalId / conditions -> CRITICAL per quality gate.
- kms-key-policy.json "AppRoleUse": kms:* to non-admin app role -> CRITICAL; no admin/user separation.
- reports-bucket-policy.json: Principal "*" public read -> CRITICAL; no aws:SecureTransport deny.
- cloudtrail.json: not multi-region, no global events, no log file validation, no KMS, retention 30 < 90.
- kms-key-config.json: EnableKeyRotation false -> HIGH.
p3: after the "fixed" versions in policies-v2 (created by prompt instructions? no) - p3 uses the same fixture and reports/security-v1.md:
  everything in v1 is still present (Remaining); new: KMS kms:* to app role, rotation disabled, no SecureTransport, CloudTrail not multi-region, retention.
  H2 (permission boundary) is arguably not applicable (no delegated admin) -> may be marked resolved/not-applicable.
v2 notes:
- Restraint: kms-key-policy.json "AccountRoot" (kms:* to arn:aws:iam::111122223333:root) is the standard key-administration
  pattern that delegates to IAM; flagging it CRITICAL is a false positive. The defect is AppRoleUse (kms:* to orders-app).
- Severity calibration: the skill's quality gate makes cross-account trust without ExternalId CRITICAL; v1 had it as High (H1),
  so the v2 report should upgrade it, not just carry it over.
- H2 (permission boundary) is not backed by any concrete policy document or delegated-admin need; the skill says validate only
  concrete policy documents, so marking it not-applicable/withdrawn is acceptable.
- Fix functionality: Lambda needs s3:PutObject/s3:GetObject on arn:aws:s3:::acme-orders-uploads/* (and s3:ListBucket on the bucket
  only if listing is needed); vendor trust keeps sts:AssumeRole for 444455556666 with sts:ExternalId; orders-app keeps
  kms:Encrypt/Decrypt/GenerateDataKey*; AccountRoot stays so the key remains manageable.
