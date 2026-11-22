# Product search service

## Request path

The catalog API sends text and filter parameters to Search Gateway. Search Gateway calls the managed search cluster over a private endpoint and returns product IDs, display fields, and facet counts. The catalog API adds price and inventory data before returning the response to the web and mobile clients.

Search Gateway owns the index alias and hides physical index names from callers. The production alias is `catalog-search-live`. The next physical index name reserved by the naming convention is `catalog-search-2025-03`; physical names use hyphens, the service name, and the month of creation. A physical index is not used by callers until the alias points at it.

The current physical index is `catalog-search-2024-11`. It has six primary shards and two replicas. The cluster is spread across three zones. Index documents contain the public catalog fields plus a non-display `merchant_group` field used for filtering.

## Service targets

Search Gateway has a 99.9% monthly availability target. The normal production budget for a search request is 180 ms at p95 and 450 ms at p99, measured at the gateway boundary. The search response must contain at least 98% of the expected top-20 product IDs on the relevance fixture for the release to be accepted. A relevance check compares IDs and facet counts, not just whether the request returned HTTP 200.

The freshness target is ten minutes from a catalog update to its appearance in search. The indexer publishes a watermark metric named `catalog_search_indexer_watermark_age_seconds`. The migration may temporarily trail this target during bulk loading, but the release record needs the maximum observed lag.

## Change ownership

Search Gateway owns alias changes and request metrics. Catalog owns document mapping and the relevance fixture. The on-call engineer for Search Gateway can pause traffic changes. A release manager records the final outcome in the release log.
