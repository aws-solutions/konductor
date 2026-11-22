# Operations notes

The nightly points job runs at 02:15 in UTC. The business date is the calendar
date in the configured business timezone, not the machine's local timezone.

Points become eligible for expiry after 365 days plus the seven-day grace
period in `data/expiry-rules.json`. The job records the `annual-expiry` reason
for downstream reports. A maintenance run may update a balance once per
customer.

For local runs, set `TZ=UTC` if you want log timestamps to match the business
calendar. The service itself reads the configured timezone for business dates.

Each job run emits the customer identifier and resulting balance to the audit
stream. A failed customer update is retried by the scheduler on the next run.
Operators can inspect the in-memory example store through the test harness;
production deployments provide the durable store through the application
adapter.
