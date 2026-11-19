# Operations notes

The service is stateless in development. Production deployments provide a
persistent delivery store through the adapter in `src/storage/deliveries.js`.

A failed customer notification is recorded and retried by the deployment
scheduler. Keep request logs at info in normal operation and use debug only
for a short diagnostic window. Do not put customer payloads in log sinks with
long retention.
