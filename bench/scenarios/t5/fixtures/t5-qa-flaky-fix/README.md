# Daymark

Daymark is a small reminder worker for teams that need calendar-day rules without running a web server. It keeps scheduled jobs in memory and writes delivery records to a JSONL outbox for a separate sender.

## Development

The project targets Node.js 24 and uses only the standard library. There is no build step. Run `npm test` to execute the checks and `npm run check` to validate the checked-in configuration.

A job has a title and a weekly rule such as `Monday 09:30`. The configured time zone is used when the worker decides whether a rule is due. The outbox directory can be moved with `REMINDER_OUTBOX`.

## Operations

The worker is intended to be run by a process supervisor. The outbox is append-only while a run is in progress, and a downstream sender can remove or archive records after delivery. Rate limiting is per job and resets at the end of its window.
