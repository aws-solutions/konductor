# Data ownership and team boundaries

The Commerce Platform team owns checkout behavior and the order lifecycle. The Fulfillment team owns inventory availability and reservation state. Payments owns authorization attempts and the payment provider integration.

Customer Foundations owns the `customer` table and the customer profile API. The table is a shared legacy table in the current cluster because account and commerce were once one application. Commerce may read the customer ID and a stable shipping snapshot through an API. Commerce does not own profile attributes and Customer Foundations approves any new writer.

The Order Platform team owns the `orders` and `order_items` tables. Fulfillment owns `inventory_reservations`. Payments owns `payment_attempts`. These ownership assignments are also used for on-call escalation and schema migration approval. A service may not use another team's database credentials in production.

The platform architecture council expects each extracted service to publish an ownership record before production traffic is enabled. A transitional read replica or replicated event stream is acceptable, but a second service writer is not.
