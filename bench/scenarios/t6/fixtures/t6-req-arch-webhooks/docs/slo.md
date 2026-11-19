# Service objectives excerpt

The public API target is 99.9% monthly availability. Payment writes have a p99 latency target of 800 milliseconds. The event outbox should accept a committed event within 60 seconds at the 99th percentile.

The current objectives do not define the time to an external callback, the treatment of an endpoint that repeatedly fails, or whether a callback counts as successful when the remote server responds slowly. Those items need an explicit product decision.
