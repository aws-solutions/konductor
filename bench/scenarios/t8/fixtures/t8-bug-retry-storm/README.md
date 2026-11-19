# Northstar order sync

This small worker forwards accepted orders to the Northstar partner service. The worker uses the shared HTTP client in `src/shared-http-client.js`; the client owns retry, circuit, and partner pacing behavior so other integrations can use the same contract.

## Local commands

Node 24 is the supported runtime. There are no third-party packages.

```sh
node --test test/
node src/order-sync-worker.js
```

The production evidence lives under `ops/`. Timestamps in the evidence are UTC. Configuration snapshots are under `config/`, and the order-sync runbook is in `ops/runbooks/order-sync.md`.

## Request contract

`createHttpClient({ transport, clock, random, ...settings })` returns `{ request }`. A transport receives `(request, { attempt })` and returns a response with `status`, `headers`, and optional `body`. A supplied clock must provide `now()`, `setTimeout()`, and `clearTimeout()`.
