# Runtime layout

The queue consumer hands one order at a time to the order-sync worker. The worker builds a request and delegates transport policy to the shared client. The transport adapter is kept outside this repository in production; the test suite supplies a function instead.

The shared client is intentionally stateful per partner endpoint. Its state includes retry attempts, breaker status, and optional pacing. A response is returned to the worker when the attempt budget ends.
