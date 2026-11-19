# Nightly ledger export

This repository contains the small worker that copies a nightly ledger snapshot into an object store. It is intentionally dependency-free and runs on Node.js 24.

## Local commands

```sh
npm test
npm run lint
node src/index.js --date 2025-02-03
```

The default local runner uses an in-memory cloud client, so the command does not contact a service. Production wiring supplies the same client interface from the platform wrapper.

Configuration lives in `config/export.json`. IAM documents used by the deployment are under `infra/iam/`.
