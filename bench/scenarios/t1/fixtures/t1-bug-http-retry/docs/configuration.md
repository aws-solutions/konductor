# Configuration

`timeoutMs` controls how long one network attempt may remain open. `retries`
is the retry setting used for transient status codes. `retryOn` can replace
the default status list when a service has different semantics.

The `logger` callback is optional. A cache is only used when `cacheTtlMs` is a
positive number and the method is GET. Request bodies may be strings or
Buffers.
