# Stored data shapes

The production order table stores `currency` in a `CHAR(3)` column. Values are ISO-style uppercase codes such as `USD`, `CAD`, and `GBP`; the database adapter rejects values outside that shape.

Order and item rows are maintained together. The store adapter exposes a single update operation so a failed item write does not leave a new order revision beside old items.

Old rows can include every status listed in `config/order-rules.json`, including `paused`. Readers must continue to display those rows while they are being moved through the packing workflow.
