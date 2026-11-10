# Notes API threat model (STRIDE, short form)

| ID | Threat | Component | Notes |
|----|--------|-----------|-------|
| T1 | Spoofing: forged or unsigned JWT accepted | auth middleware | Secret falls back to a default in dev |
| T2 | Tampering: SQL injection via search query | /search | |
| T3 | Information disclosure: one user reads another user's profile | /users/{id} | |
| T4 | Elevation of privilege: non-admin deletes users | /admin | |
| T5 | Information disclosure: stack traces in error responses | error handler | |
| T6 | Tampering: malicious file upload served from public/ | /uploads | |
