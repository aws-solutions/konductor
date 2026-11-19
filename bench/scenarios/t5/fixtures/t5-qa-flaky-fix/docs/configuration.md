# Configuration

The default file is `config/default.json`. `REMINDER_TIME_ZONE` changes the calendar zone, `REMINDER_OUTBOX` changes where JSONL records are written, and `REMINDER_RATE_LIMIT` changes the per-job count.

Configuration is read when an application is created. Tests and command-line tools can pass an explicit object to avoid changing the process environment.
