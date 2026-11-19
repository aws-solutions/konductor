# Tracking plan excerpt

This is the February working copy. Event names are case-sensitive in the collector.

| Event | Trigger | Source of truth | Dashboard use |
|---|---|---|---|
| `signup_started` | first submit of account form | app event | top of funnel |
| `profile_completed` | minimum profile accepted | app event | profile step |
| `verification_email_sent` | provider accepts message | messaging ledger | message delivery |
| `email_verified` | identity service accepts token | identity backend, mirrored to app analytics | verification step |
| `onboarding_completed` | first plan saved | plans service | completed onboarding |

The analytics mirror is useful for cohort slicing but is not the record of a successful token exchange. Reconciliation should compare the app event with the identity backend at least weekly. Missing-event alerts are expected when the app count is more than 8% below the backend count.

The February 3 export has an alert for `email_verified`. The alert was closed as a configuration issue after identity records were compared with the backend ledger. Do not use an un-reconciled analytics count as a conversion denominator.
