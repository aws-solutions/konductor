# Input and report schema

Each line of an input export is a JSON object with `endpoint`, `latency_ms`, and `status`. Endpoint values are strings. Latency is measured in milliseconds. Status is the HTTP response status. The report groups records under `endpoints` and includes `count`, `error_count`, `p50_ms`, and `p95_ms` for each group.
