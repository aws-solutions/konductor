# Operations

Use `migrate` for the initial copy, `resume` after an interrupted run, and `verify` before switching traffic. Keep the checkpoint and dead-letter files with the run record. A failed change can be retried from the admin command after its cause is understood.

Timestamps in captured records are serialized as ISO-8601 strings. The source export contains occasional blank fields, so the mapper receives raw values rather than a pre-cleaned object.
