# Release log

## 2025-01-21 — 4.19.0 messaging configuration

Owner: Imani Cole. We moved transactional mail from `mail.harborlight.app` to `verify.harborlight.app` while separating product mail from receipts. The mobile build and the verification copy were otherwise unchanged. The Messaging runbook says the new domain needs aligned sender authentication and provider warm-up; the rollout note says the first batch was monitored manually.

## 2025-02-03 — analytics configuration regression

Owner: Tomas Venn. A mobile analytics configuration update stopped forwarding `email_verified` and `onboarding_completed` from some app sessions. The email service and identity backend still recorded sends and successful token exchanges. Dashboards showed a much smaller verification step for this week. The configuration was corrected in 4.20.0 on 2025-02-10.

## 2025-02-10 — 4.20.0

Restored the missing mobile event mappings and added a release smoke check. No onboarding copy, form fields, or email template changes were included.

## Loose notes

- There was also a small icon refresh in 4.19.0.
- No one has yet tied the mail-domain work to the app-store reviews in a formal incident report.
