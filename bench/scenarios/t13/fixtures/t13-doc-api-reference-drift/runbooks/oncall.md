# On-call notes

The package is embedded in several small services. Look at caller logs before changing retry settings. A queue that is paused intentionally may have no active work. Preserve the original error when escalating a failed job.

Routine checks: test the health endpoint, inspect queue depth, and check for repeated upstream status codes.
