# Relay Hook Worker

Relay Hook Worker accepts signed webhook deliveries and hands them to a small application callback. It is deliberately dependency-free so it can run as a single process beside an existing service.

## Run

Use Node.js 24 or newer. The test command is:

```sh
npm test
```

The worker is normally created by the host service and receives a delivery object with an `idempotencyKey` and `payload`. A successful delivery is acknowledged after the callback completes.

## Configuration

Runtime defaults live in `config/default.json`. Environment values are read by the launcher rather than by the delivery modules, which keeps the modules easy to exercise in tests.
