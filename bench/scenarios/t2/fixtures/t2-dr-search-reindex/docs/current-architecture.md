# Current search architecture

_Last reviewed 2025-02-06 by Catalog Platform._

## Request path

The web and mobile clients call `GET /v2/search/products` through the catalog gateway. The gateway adds the tenant and locale filters, then sends the request to the `products-read` alias in the search cluster. Search responses include a request ID and a result page, but clients do not know the concrete index name.

The alias has one read target today, `products-2024-11`, and the writer uses the same concrete index. The search service owns the alias update permission; the catalog API does not receive cluster credentials.

## Product updates

Catalog API writes the canonical product record to the catalog database and publishes a product-change event. The search writer consumes the event and sends a complete document to the concrete search index. An update is considered accepted after the writer receives a successful bulk response. A delete event removes the document by product ID. Events are retained in the catalog stream for 24 hours, and the writer normally commits its consumer position every five seconds.

The document in the index contains denormalized category labels, availability, and locale-specific text. Those fields are assembled by the writer and are not a byte-for-byte copy of one database table. A re-index therefore reads the current search document from the old index rather than reconstructing it from the catalog database.

## Cluster conventions

Indices use one primary shard per 90 to 120 GiB of expected data and one replica. Index names carry the release month. The `products-read` alias is used by readers, while the concrete index name is used by the current writer deployment. The cluster accepts an alias update as one request containing remove and add actions.

The normal writer can retry a rejected bulk request three times with exponential delays. It does not retry a response that reports a document version conflict. The search service emits `search.bulk.failures` and `search.writer.lag_seconds`; the on-call dashboard shows both by index name.
