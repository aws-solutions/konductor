# Library usage

A `Schedule` accepts five fields: minute, hour, day of month, month, and weekday.
Fields support wildcards, comma-separated values, inclusive ranges, and steps.
`next_run` returns the first matching minute strictly after the supplied datetime.
A timezone offset attached to the datetime is retained in the result.

`RetryPolicy` counts attempts from one. A delay is computed after a failed attempt,
and the configured maximum delay is inclusive.
