# Background job and storage limits

The export worker shares a queue with calendar rebuilds and large syncs. There is a per-account limit of one active long-running archive job; later submissions are queued or rejected according to the endpoint, which has not been selected.

The object store accepts multipart uploads. The operations team currently pages on archives above 2,000 MB and on jobs that have been waiting for 90 minutes. These are operational alerts, not customer-facing export limits.

Workers retry transient failures and keep job state in the activity service. The page does not define the customer-visible completion deadline, archive retention, or what happens when an archive is too large.

Owner: Pavel Novak, Infrastructure, 2025-03-03.
