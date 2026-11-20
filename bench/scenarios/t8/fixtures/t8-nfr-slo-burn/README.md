# Checkout operations folder

This is the working set for the Checkout Payments API. It contains the traffic sample used by the weekly reliability review, service telemetry definitions, alert configuration, deployment records, and a few notes kept by the on-call rotation.

The request sample covers 2025-04-01 through 2025-04-28 in UTC. `traffic_class` distinguishes customer traffic from synthetic probes and health checks. The service team uses the request counters for availability and the latency buckets for the tail-latency review.

The API calls the card network through the client described in `vendor/card-network-note.md`. Operational evidence is in `logs/`; timestamps in logs are UTC. Files under `fixture/` are source material and should be treated as read-only during an analysis.
