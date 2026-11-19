# Operations

The library does not create worker threads. Applications own execution and can use
`RetryPolicy.run` with their own sleep function. The limiter clock is injectable so
services can use a monotonic clock and tests can use a deterministic one.
