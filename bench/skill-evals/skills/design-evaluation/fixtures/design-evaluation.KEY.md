# Answer key: design-evaluation fixture

Scope is SMALL (2 engineers, ~300 req/day). Blockers per the skill's quality gate:
- CRITICAL: T1 in threat-model.md is HIGH severity and unmitigated (no tenant check on GET /exports/{id}).
- CRITICAL: no failure handling for the MailRelay external dependency (no timeout, retry, fallback) in system-design.md "Failure handling".
- CRITICAL: data model cannot serve AP2 (list by tenant) or AP3 (stuck QUEUED) - no GSI.
- CRITICAL: api.yaml plans a breaking response change (downloadUrl -> downloadUrls) with no versioning.
- IMPORTANT: observability TBD; no runbook; no cost validation (3-region active-active + EC2 Kafka).
- Over-engineering for scope: 3-region active-active and self-managed Kafka for 5 req/min.
- Testability: SDK/MailRelay called directly in handlers, hard to mock; no integration test plan.
- Security: buildExport has dynamodb:* on * (iam.md).
