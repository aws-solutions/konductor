# Service runbook

## Health

`GET /health` returns a short JSON object. Check the process and the writable data directory before restarting it.

## Corrupt store

Stop the process, copy the JSON data file to a dated evidence directory, and validate it with `node scripts/check-json.js`. Restore the most recent known-good copy only after checking the changelog entry associated with it. Do not edit a live file while the server is running.

## Slow requests

Inspect request duration logs and the JSON file size. The service has no external database. A large file should be copied before a compaction change is attempted. Member invitation writes are a useful example of the store's serialized write pattern.

## Release

Run the visible tests and both repository checks. Deploy the image to the first environment in `ops/rings.json`, watch the service health and request error metrics, and continue through the listed rings only after the previous ring is quiet.
