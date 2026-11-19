# Reporting team contract

The reporting team receives a read-only PostgreSQL role on the order database. Their scheduled SQL jobs join `orders`, `order_lines`, and `order_audit` to produce revenue, cancellation, and agent-activity reports. The jobs run at 02:00 UTC and may take up to 40 minutes. They do not call the order API.

The contract requires seven years of report reproducibility. Reports use the order status at the report's `as_of` timestamp and include the actor for support changes. The reporting team owns the SQL and expects a schema notice at least 60 days before a breaking change.

A daily export to the warehouse exists for older periods, but the export has a two-day delay and does not include the full audit payload. The reporting team uses the database for current-day operational questions and has no streaming consumer in production.
