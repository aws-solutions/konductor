# Data retention

Document objects are retained for 180 days after their workspace is closed. Metadata records are retained for 365 days so that audit exports can be reconciled.

The cleanup worker records a count and a request id. It does not include document contents in logs. A failed cleanup is retried by the scheduler after the next daily window.
