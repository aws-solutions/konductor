---
name: tarnwick-conventions
description: How the Tarnwick team writes commit subjects, service log lines and setting names. Use when writing a commit message, a log statement or an environment variable name for a Tarnwick service.
---

# Tarnwick Team Conventions

## Commit Subjects

A subject has three parts joined by ` :: ` (a space, two colons, a space): ticket, area, summary.

- Ticket: `TW-` and the ticket number as four digits, padded with zeros. Ticket 42 is `TW-0042`.
- Area: one of `api`, `web`, `jobs`, `docs`.
- Summary: all lower case, no full stop at the end, 50 characters or fewer.

A commit that changes a database table ends its body with the line `Schema: changed`. No other commit has that line.

Example: `TW-0107 :: jobs :: drop empty batches before upload`

## Log Lines

A service writes one line per event: four `key=value` pairs separated by single spaces, in the order `t`, `sev`, `svc`, `msg`.

- `t`: whole seconds since the Unix epoch.
- `sev`: one digit. 1 is info, 2 is warning, 3 is error.
- `svc`: the service name in lower case.
- `msg`: a sentence in double quotes, lower case, no full stop at the end.

Example: `t=1767225600 sev=2 svc=ferry msg="retry queue is above half full"`

## Setting Names

A setting is an environment variable named `TWK__<SERVICE>__<GROUP>__<NAME>`.

- Every part is upper case. Words inside a part are joined by one underscore.
- Parts are separated by two underscores.
- A duration ends in `_SECS` and a size ends in `_KIB`.

Example: `TWK__FERRY__RETRY__MAX_DELAY_SECS`
