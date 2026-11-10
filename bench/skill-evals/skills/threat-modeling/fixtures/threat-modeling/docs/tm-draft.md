# DocShare threat model (draft)

## Threats
| ID | Category | Threat | Severity |
|---|---|---|---|
| T-001 | Denial of Service | Flood of GET /s/{token} requests | High |
| T-002 | Tampering | Document modified in S3 | Medium |
| T-003 | Repudiation | Owner denies creating a share | Low |

## Mitigations
| ID | Threat | Mitigation |
|---|---|---|
| M-001 | T-002 | S3 versioning |
| M-002 | T-003 | CloudTrail data events |
