# Architecture overview

Harbor Hand has four boundaries. `src/queue/` turns broker deliveries into a small internal job shape, `src/worker/` owns leases and completion, `src/http/` serves health and readiness, and `src/metrics/` emits measurements. The config layer is intentionally small and is consumed by these boundaries rather than by the queue adapter.

A process has one poller and a worker pool. A job is acknowledged only after the handler records a result. The HTTP server does not share queue connections with the poller.

Shutdown starts at the HTTP control point, stops intake, waits for active work, and then closes the broker. The service is stateless apart from broker leases and structured logs.
