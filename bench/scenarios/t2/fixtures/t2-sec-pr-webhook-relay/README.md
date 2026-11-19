# Relay Gateway

Relay Gateway accepts events from our source-control and billing providers and
turns them into a small internal event stream. It is intentionally a plain
Node.js service so it can run on a maintenance host without a build step.

## Run locally

Copy `.env.example` to `.env`, then run `npm test` or `npm start`. The service
listens on `PORT` and exposes `/healthz` and provider-specific event routes.
Local tests use only Node's built-in test runner.

## Event flow

The router reads a request, verifies the provider envelope, records the event,
and invokes the configured customer notification destination. Delivery records
are kept in memory in development and are replaced by the deployment adapter.

Configuration details live in `config/default.json` and the provider contracts
are documented in `docs/provider-signatures.md`.
