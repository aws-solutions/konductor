# Decision 0001: JSON for local persistence

We chose a JSON file because the service has a small footprint and operators can inspect a snapshot. Writes use a temporary file and rename.

The cost is that large collections need full-file serialization, so limits remain conservative.
