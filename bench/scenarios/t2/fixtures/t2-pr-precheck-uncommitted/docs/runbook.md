# Local runbook

Use `NODE_ENV=test node --test` when changing request handling. The test configuration keeps the listener disabled unless a test starts one explicitly.

For a local request, send JSON to `/quote` with a postal code of at least three characters. Logs are line-oriented JSON so a shell can filter them during debugging.
