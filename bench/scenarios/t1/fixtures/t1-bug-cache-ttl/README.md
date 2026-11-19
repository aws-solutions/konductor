# Profile and permission service

This repository contains the small lookup service used by the account gateway. It keeps profile and permission records in memory and uses a bounded TTL cache in front of the data store.

## Development

The service needs Node.js 24 or newer and has no third-party runtime dependencies.

```sh
npm test
npm run check
```

The command-line example reads the records in `data/` and prints a short health report. The handlers are deliberately transport-neutral so they can be used by an HTTP adapter or a job runner.

Configuration defaults live in `config/default.json`. The cache is process-local, so restarting the service clears cached records.
