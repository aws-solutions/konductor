# threat-modeling fixture key (judge only)

doc-share.md documented facts: Cognito authorizer except GET /s/{token}; 128-bit bearer token in URL; 15-min presigned URL; 30-day default expiry; no revocation; no rate limiting; handler logs the full event (token + recipient PII leak to logs); DynamoDB AWS owned key; S3 SSE-KMS CMK + BPA; SES email (link interception/forwarding). Not documented: WAF, Shield Advanced, VPC, GuardDuty, MFA. A model that asserts those exist as current controls is hallucinating (they may appear as recommended mitigations).
Trust boundaries: internet -> CloudFront/API GW; unauthenticated GET route; SES -> recipient mailbox.
Out of scope: billing, admin console, search.

change-upload.md: new unauthenticated write path; filename from body -> key path traversal/overwrite (`../`), no size limit (cost DoS), malware upload, token reuse grants write.

tm-draft.md planted gaps: no Spoofing / Elevation of Privilege / Information Disclosure analysis, no authentication or authorization threats; T-001 is High with no mitigation; encryption in transit/at rest not addressed; no trust boundaries; no security testing strategy.
