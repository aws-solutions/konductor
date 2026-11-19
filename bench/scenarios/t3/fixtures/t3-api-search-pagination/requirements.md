# Product search service requirements

The catalog team is moving product discovery into a service that must handle a catalog of roughly 60 million items. Search results need a stable order while records are added or removed, and a client that loses its connection must be able to continue from the last response without downloading earlier pages again. A returned continuation value may be stored by a client, but it is an implementation detail rather than a representation of a catalog row.

The production service-level targets are recorded in the tables under `service-limits.csv`, `capacity.csv`, and `reliability.csv`. The most important latency target is the 99th percentile for a search request. The target is measured at the service boundary under the peak load described in `traffic.csv`.

## Acceptance notes

| Concern | Product expectation |
| --- | --- |
| Result order | Repeating a request with the same search inputs must not silently skip or repeat a result because another item was indexed. |
| Client behavior | Browser users normally stop around page 40; crawler clients can continue until no continuation value remains. |
| Request shape | A caller can ask for a bounded number of results and can supply the value returned by the preceding response. |
| Failure behavior | A client can retry a page without exposing internal storage keys in the public API. |

The service should support the existing product fields and remain usable by clients that only understand JSON over HTTPS. Keep the public contract small enough that a later storage change does not require a client migration.
