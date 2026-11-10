# ADR-0003: Use SNS for outbound notifications
Status: Accepted (2025-02-11)
Context: We need fan-out to email and push providers.
Decision: Publish notification events to SNS; providers subscribe.
Consequences: No ordering guarantees. Scheduling of notification jobs is out of scope for this ADR and stays on the cron worker for now.
