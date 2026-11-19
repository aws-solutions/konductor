# Operations

The process writes one JSON log object per request to standard output unless the configured log level is `silent`. Health and readiness endpoints are intentionally small so a load balancer can poll them.

For a local run, use `NODE_ENV=test npm start` if you want the quieter test settings.
