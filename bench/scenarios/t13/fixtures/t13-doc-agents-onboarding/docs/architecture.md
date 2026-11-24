# Architecture

The gateway handles HTTP requests and calls the identity and profile paths. The
worker processes asynchronous preference jobs. The database is the shared state
store for the service. Health checks are deliberately cheap and do not replace
request-level monitoring.
