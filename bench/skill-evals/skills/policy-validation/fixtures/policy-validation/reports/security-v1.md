# Security Policy Validation Report (v1, previous review)

## Critical Issues
- C1: lambda-role-policy.json grants `s3:*` on `*`.
- C2: reports-bucket-policy.json allows public `s3:GetObject` (Principal `*`).
- C3: CloudTrail log file validation disabled.

## High Priority Issues
- H1: vendor-trust-policy.json cross-account trust has no `sts:ExternalId` condition.
- H2: Lambda role missing a permission boundary.

Overall Security Posture: 41/100
