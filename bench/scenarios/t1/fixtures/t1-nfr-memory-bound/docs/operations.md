# Operations

The worker is stateless between process restarts apart from the delivery de-duplication table. Keep the process behind the service's normal request timeout and send logs to standard output.

Health checks should call `node scripts/healthcheck.js`. A non-zero exit means the runtime is not supported.
