# Schema notes

The `customers` table holds identity and lifecycle fields. Older records may have blank optional values.

The `addresses` table holds customer address data with the following columns:
- `id` - INTEGER PRIMARY KEY, auto-generated
- `customer_id` - INTEGER NOT NULL, references customers, unique (one address per customer)
- `line1` - TEXT, first address line
- `line2` - TEXT, second address line (optional)
- `city` - TEXT, city name
- `region` - TEXT, state/province/region
- `postal_code` - TEXT, postal/ZIP code
- `country` - TEXT, country name

A customer with no address has no row in the `addresses` table. Blank values (NULL, empty, or whitespace-only) are not stored.

The migration history is kept in `schema_migrations`; a row means the corresponding numbered script completed.
