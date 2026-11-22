# Search contract notes

Search Gateway keeps the public API stable while the physical index changes. Callers expect a stable ordering for equal scores, facet counts that correspond to the returned filter set, and an empty result represented by a successful response with an empty `items` array. A missing field is not equivalent to an empty string for filter evaluation.

The catalog relevance fixture contains 200 saved queries across brand, category, typo, price, and availability cases. The fixture is stored with the catalog team and is versioned with the catalog export. The release gate compares the top 20 IDs and facet counts against the approved baseline. A reviewer can run the comparison with the `search-fixture compare` command after loading credentials from the local developer environment.

The service emits a request ID and index name in internal logs. The physical index name is not part of the public response. Search Gateway's alias is the only supported caller-facing route to a physical index.
