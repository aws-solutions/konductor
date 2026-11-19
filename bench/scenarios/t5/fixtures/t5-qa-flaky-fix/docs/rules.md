# Calendar rules

Rules repeat weekly. A rule contains a weekday name, an hour from 0 through 23, and a minute from 0 through 59. The worker compares the local calendar fields in the configured IANA time zone.

A delivery record includes the job id, title, and the instant at which the worker emitted it. Disabled jobs remain in the in-memory list but are not delivered.
