# Threat model: FileDrop

Scope: the eight components and seven flows in `docs/architecture.md`. Method: STRIDE per component and per flow. Likelihood and impact are rated high, medium or low.

## Assets

- Uploaded files (confidentiality and integrity).
- Share link tokens and link passwords.
- User records and session cookies.
- The admin capability (deleting any file).
- Storage budget (availability and cost).

## Trust boundaries

1. Browser to API service (untrusted client to backend).
2. API service to object store and metadata database (backend to data stores).
3. Object store to the public internet through pre-signed URLs.
4. API service to the identity provider (external party).
5. Scan worker and mailer to the queue and the SMTP relay.
6. Recipients (anyone holding a link) to the API service.

## Components covered

Web app, API service, identity provider, object store, metadata database, scan worker, mailer, admin console. Each appears in at least one threat below.

## Threats

| ID | STRIDE | Component and flow | Threat | Likelihood | Impact | Mitigation |
|----|--------|--------------------|--------|------------|--------|------------|
| T1 | Information disclosure, Spoofing | API service, share link (flow 3) | The share token has 6 characters from 36 symbols, about 2 billion values. An attacker can guess or enumerate live links and download files, with no limit on lookups. | High | High | Random token of at least 128 bits, rate limit link lookups, alert on many misses. |
| T2 | Tampering, Elevation of privilege | Object store, scan worker (flow 2) | A file can be downloaded as soon as it is uploaded, before the scan finishes. Malware is served during the scan window. | High | High | Upload to a quarantine prefix, move to the public prefix after a clean scan, block download until then. |
| T3 | Information disclosure | Share link and pre-signed URL (flows 3 and 4) | Links never expire by default and the download URL is valid for 24 hours, so a forwarded or logged URL gives access long after sharing. | Medium | High | Default expiry of 7 days, download URLs of 5 minutes, revoke links, show the owner who has a link. |
| T4 | Repudiation | API service, admin console (flow 7) | Successful downloads and admin actions are not logged, so nobody can prove who downloaded a file or who deleted one. | Medium | Medium | Append-only audit log of downloads (time, link, requester address) and admin actions (who, what), protected from edit. |
| T5 | Denial of service, Information disclosure | API service (flows 2 and 4) | No limit on password attempts allows brute force of a 4-character password. No upload size limit lets one user fill storage and raise cost. | High | Medium | Lock out after 5 failed attempts per link, rate limit by address, cap size per file and quota per user. |
| T6 | Elevation of privilege | Admin console, API service (flow 6) | The admin menu is hidden in the UI but the admin endpoints only require a valid session, so any signed-in user can call them and delete files. | High | High | Check the admin role on the server for every admin endpoint, add tests that call them as a normal user. |
| T7 | Information disclosure | Mailer (flow 5) | The email carries the link and file name. TLS is used only when the receiving server supports it, so the message can cross the network in clear text, and it stays in inboxes and forwards. | Medium | Medium | Require TLS to the relay and between servers, leave the file name out of the email, short link expiry. |
| T8 | Information disclosure | Metadata database (flow 3) | Link passwords are unsalted SHA-1 hashes of short passwords. After a database leak they are cracked offline in seconds. | Medium | Medium | Salted slow hash (argon2 or bcrypt), minimum length of 10, or replace link passwords with one-time codes. |
| T9 | Spoofing, Tampering | Web app, identity provider (flow 1) | The session cookie lasts 30 days and no HttpOnly, Secure or SameSite attributes or CSRF protection are described, so a stolen cookie or a forged request works. | Medium | High | HttpOnly, Secure and SameSite=Lax cookies, CSRF tokens on state-changing requests, session lifetime of 8 hours with refresh. |

## Residual risk and next steps

T1, T2 and T6 are the highest priority and should be fixed before launch. The identity provider is outside our control; its failure or compromise is accepted risk with monitoring on sign-in anomalies.
