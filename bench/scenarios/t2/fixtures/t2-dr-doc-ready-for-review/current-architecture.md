# Current notification architecture

The account settings web application calls `settings-api` for profile and preference changes. The API stores account data in the Settings PostgreSQL cluster. The cluster is shared by several settings features, so the preference design must not require a schema change on every sender.

The messaging gateway reads account attributes from `profile-cache` before it creates a delivery request. The cache is refreshed from the `account.changed.v1` stream. The stream is partitioned by account ID and preserves order within a partition. Consumers acknowledge an event after applying it to their local view. A consumer may receive the same event more than once after a retry.

The notification sender has a local preference view in the Messaging database. Its current reader treats a missing category as enabled for account activity and billing and disabled for product updates and recommendations. The reader accepts a complete category map from the preferences consumer and keeps the last event version per account. It does not evaluate customer-supplied expressions.

The existing unsubscribe service remains authoritative for legally required mail. A preference response can therefore say that a category is enabled while the unsubscribe service still blocks a particular legal destination. The sender checks both sources before dispatch.

The platform has a small `outbox_events` table beside the settings write path. A worker publishes rows to the account stream and retries a failed publish. The worker does not guarantee a delivery time, but its normal queue age is visible in the operations dashboard. No current service depends on a synchronous callback from Settings to Messaging.