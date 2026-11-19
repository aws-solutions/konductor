# Search service targets

_Owned by Reliability Engineering. Values apply to the primary region._

| Signal | Target | Page threshold |
| --- | ---: | ---: |
| Search availability | 99.95% monthly | below 99.9% for 10 minutes |
| p95 search latency | under 220 ms | above 350 ms for 10 minutes |
| p99 search latency | under 450 ms | above 800 ms for 5 minutes |
| empty-result rate for the daily control query | under 1.5% | above 3% for 10 minutes |
| writer event lag | under 60 seconds | above 300 seconds for 5 minutes |
| bulk failure rate | under 0.1% | above 1% for 5 minutes |

The daily control query is a fixed set of 24 product searches covering each supported locale and two category filters. Reliability keeps the expected result IDs in the `search-control` dashboard. The dashboard compares the control query with the previous day, but it does not automatically stop an index operation.

The search endpoint may return HTTP 200 with an empty result set. The client treats that as a valid response, so HTTP success alone is not an indication that the catalog is usable.
