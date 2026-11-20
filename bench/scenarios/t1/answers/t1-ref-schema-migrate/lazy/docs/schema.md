# Schema notes

The `customers` table holds identity and lifecycle fields. Older records may have blank optional values.

The `addresses` table holds customer address data with columns: `id`, `customer_id`, `line1`, `line2`, `city`, `region`, `postal_code`, `country`. Each customer has at most one address row.

The migration history is kept in `schema_migrations`; a row means the corresponding numbered script completed.
