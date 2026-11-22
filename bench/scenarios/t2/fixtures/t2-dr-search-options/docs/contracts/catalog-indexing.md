# Catalogue indexing contract

The Catalogue service owns product changes and publishes a versioned `catalogue.product.changed` event after a product transaction commits. Events contain the product id, all localized titles, department, brand, current searchable flags, and the catalogue version. Consumers may receive a duplicate event and may receive events out of order; the version is the ordering field for one product.

The current publication path delivers 99.9% of events within two minutes. The catalogue team also publishes a complete compressed snapshot every night at 01:00 UTC. The latest snapshot contains 18.4 million active products and 49.6 million localized title rows. A consumer that starts from an empty index loads the snapshot, then applies the event stream from the snapshot version.

The storefront contract requires title changes to be visible within 10 minutes of approval. A failed consumer is replayed from the last acknowledged event. A full snapshot takes about 6 hours to generate and is retained for seven days. The catalogue team owns snapshot generation; the search consumer owns its target index and its replay checkpoints.

A release may switch reads to a new index only after the target has reached the snapshot version and the consumer has caught up with the event stream. The old index remains available during a release window so the caller can be returned to the previous target.
