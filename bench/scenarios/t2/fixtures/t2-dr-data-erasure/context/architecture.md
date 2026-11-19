# Current platform architecture

The consumer app runs in two regions. The API tier is stateless and uses the Account service for identity, a PostgreSQL primary for account records, and Redis for short-lived sessions. Changes to the primary are published to the `account-events` topic. The Search service consumes that topic and maintains the user-facing profile index in OpenSearch. The Data Platform service consumes the same stream into the `customer_activity` tables in the analytics warehouse.

The deletion proposal adds a `deletion_requests` table in the Account service and a worker deployment that reads `account-deletion` messages from the managed queue. The worker has network access to the Account, Search, and Object Storage APIs. It does not have direct warehouse credentials; Data Platform owns warehouse writes and accepts signed events on `data-control-events`.

The email system is a separate vendor integration. The Notification service owns its API key and sends receipts, alerts, and product mail. Account workers do not call the vendor directly. Notification stores delivery metadata and a provider-side recipient record for suppressed or bounced addresses.

Primary account rows use `account_id` as the stable identifier. Email address and display name are copied into event payloads for some downstream consumers. Object Storage contains user-uploaded exports and avatars under a prefix containing the account ID. Search and warehouse records retain the account ID even after the primary row disappears.

Production deployments use infrastructure-as-code and a separate service account for each worker. Queue messages are at-least-once, and a visibility timeout returns an unacknowledged message to the queue. There is no distributed transaction spanning the primary, search, warehouse, and third-party services.
