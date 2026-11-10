# Threat Model - Report Export Service

| ID | Threat | STRIDE | Severity | Mitigation |
|----|--------|--------|----------|------------|
| T1 | Tenant A guesses tenant B's export id and calls GET /exports/{id} | Information disclosure | HIGH | Open - not yet decided |
| T2 | Pre-signed URL forwarded to a third party | Information disclosure | MEDIUM | URL expires after 15 minutes |
| T3 | Flood of POST /exports from one tenant | Denial of service | MEDIUM | API Gateway usage plan, 10 req/min per tenant |
| T4 | MailRelay API key leaked | Spoofing | HIGH | Stored in Secrets Manager, rotated every 90 days |
