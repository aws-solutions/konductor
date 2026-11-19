# Customer sync

Customer sync moves customer profiles from the old account store into the current account store. A run can copy an initial snapshot and then consume changes from the capture log. The command line entry point is `src/cli/admin.js`.

The service is intentionally small and uses file-backed stores in local development. Production adapters are selected by configuration. The normal release check is `npm test`, which uses Node's built-in test runner.

## Run a sample

```sh
node scripts/seed-demo.js
node src/cli/admin.js migrate --limit 100
```

Checkpoint files belong to the runtime directory and should be retained until a migration has been verified. Change records use ISO-8601 timestamps and carry the source record version when one is available.
