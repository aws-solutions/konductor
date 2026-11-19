# Database operations notes

The Postgres primary is sized for the normal checkout pool and the reporting jobs. The pooler owns client-side admission and exposes active, idle, and waiting counts. A pooler restart preserves the database volume but drops in-flight client sessions, so the on-call record must include the restart time.

Routine database warnings include idle client cleanup and statistics refresh. Those messages are expected when their count remains small and the service continues to return successful orders.

Configuration edits are normally reviewed in the weekly repository change and applied during a controlled window. The pooler log is the source of truth for what the running process accepted.
