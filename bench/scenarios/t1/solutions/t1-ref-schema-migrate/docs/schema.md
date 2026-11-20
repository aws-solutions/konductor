# Schema notes

The `customers` table holds identity and lifecycle fields. Migration 013 moves the six address values into `addresses`, keyed by `customer_id`. A customer can have no address row; each customer with address data gets one row, even when two customers have identical values.

The migration history is kept in `schema_migrations`; a row means the corresponding numbered script completed. Migration 013 has a down step that puts the values back into the legacy columns before removing `addresses`.
