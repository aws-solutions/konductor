# Notification preferences

**Status:** Proposed for wider review  
**Owner:** Notifications Platform  
**Review partners:** Account Settings, Messaging  
**Last updated:** 2025-03-04

## 1. Summary

### 1.1 Decision requested

This proposal adds one account-level notification-preference record and a small API for reading and changing it. The record covers four message categories and two channels. Settings owns the customer experience, Notifications Platform owns persistence and publication, and Messaging consumes a versioned event into its existing local preference view.

The design uses the Settings PostgreSQL cluster for the source record and the existing outbox worker for asynchronous publication. It does not add a request-time call from Settings to Messaging. The sender continues to check the legal unsubscribe service before dispatch.

### 1.2 Why this change

Customers currently find related controls in more than one product screen. A single record gives the settings screen and message senders the same category and channel state. It also gives the teams a stable place to add later categories without changing every sender integration.

The first release supports account activity, billing, product updates, and recommendations. Account activity and billing start enabled. Email and push can be changed independently for each category. The existing unsubscribe path remains authoritative for legally required mail.

## 2. Goals and boundaries

### 2.1 Customer outcome

Customers should feel in control of the messages they receive, and a saved choice should become visible to the sender quickly enough that the settings screen feels dependable. The experience will be consistent across the account settings page and message delivery, with no confusing difference between a setting shown in the UI and a setting used by a sender.

### 2.2 Non-goals

This release does not change message templates, delivery providers, or the legal unsubscribe mechanism. It does not provide quiet hours, per-message conditions, channel ranking, tenant-specific policy, or a visual rule editor. It also does not migrate historical preference data from product-specific screens; those screens will be retired or redirected as a separate account-settings effort.

The API will not expose customer-written expressions. It will accept the four known categories and the two known channels only. A later proposal may use observed preference data to decide whether additional controls are useful.

### 2.3 Success measures

At launch we will support 10 million accounts and use the following targets: API availability of 99.9 percent, read p95 below 120 milliseconds, write p95 below 180 milliseconds, and sender visibility within 60 seconds for at least 99 percent of saved changes. These are the targets in the platform service sheet. We will review the measures at the end of the controlled rollout and again after the first month.

## 3. Context and requirements

### 3.1 Existing request and read paths

The account settings application calls `settings-api`, which stores account data in the Settings PostgreSQL cluster. Messaging does not read that database during delivery. Instead, its preference consumer maintains a local view from the account stream. The sender reads the local view and then checks the legal unsubscribe service before it dispatches.

The existing outbox table is written beside the settings transaction. A worker publishes an event after the transaction commits and retries a failed publish. The account stream preserves order by account ID, but a consumer can see a retry more than once. The Messaging reader already keeps the last event version per account and ignores an older replay.

### 3.2 Product and service constraints

The product brief asks for four categories and independent email and push choices. It expects 10 million accounts at launch and 25 percent account growth in the next 12 months. The current registry has 8 million active accounts. Account Settings can schedule one schema migration in the quarterly release window, and its on-call team supports the existing outbox worker but not a new policy service.

Messaging requires a versioned event containing account ID, event version, changed categories, and emitted-at time. Events must not contain email addresses or device tokens. The first rollout starts at five percent of eligible accounts and remains there for one observation day.

### 3.3 Terminology

A preference record is the complete four-category, two-channel state for one account. An effective preference is that state after the legal unsubscribe service is also checked. Visibility means the point at which the Messaging local view uses a saved preference. The outbox is the set of rows written with a database change and published asynchronously by a worker.

## 4. Proposed design

### 4.1 Preference record and API

The new table stores one row per account with an account ID, a record version, four category objects, created and updated timestamps, and an optional last-updated source. Each category object has `email` and `push` booleans. The database applies a unique constraint on account ID and a check that the category and channel values are known.

The read endpoint returns a complete record, including defaults for an account that has not saved preferences. The write endpoint accepts a complete category map and an expected record version. A stale version returns a conflict so that the settings screen can reload rather than overwrite a newer choice. The API validates account ownership from the authenticated account context and never accepts an account ID as permission to act on another account.

The first write creates the record with account activity and billing enabled and product updates and recommendations disabled. A later partial update is normalized to a complete record before it is stored. This keeps the event and the sender view deterministic.

### 4.2 Commit, publish, and consume

The write transaction updates the preference row and inserts an outbox row containing the new account version and changed category values. The existing worker publishes a `notification.preference.changed.v1` event to the account stream after commit. The event carries the account ID, event version, changed categories, and emitted-at timestamp. The Messaging consumer applies an event only when its version is newer than the version in its local view.

This asynchronous boundary keeps the settings request path independent from Messaging. It also gives operators a replayable record when a consumer is unavailable. A successful API response means the source record is committed; it does not claim that the sender has already seen the event. The UI confirms the save and displays the last saved time.

### 4.3 Preference policy evaluation

The service will include a small policy layer beside the preference table. It will represent the default state as rules, resolve a category against account attributes, and leave room for future conditions such as quiet hours and channel ranking. For the first version, the policy layer will accept the category map from the API and return the effective booleans for the event.

Keeping this decision in one place should make later policy changes easier to review. The policy interface will use named inputs rather than a free-form expression, and the initial implementation will have a small set of built-in rules. The layer will be covered by unit cases for defaults, explicit opt-outs, and unknown categories. No sender will need to know how the result was computed.

### 4.4 Delivery and legal unsubscribe

Messaging reads the local preference view for each delivery decision. It treats a missing account-activity or billing value as enabled and a missing product-update or recommendation value as disabled, matching the current reader defaults. It then asks the existing unsubscribe service whether the destination is legally blocked. A legal block wins over the account preference.

A preference event never includes an address or device token. The sender resolves delivery destinations through its current account and device stores. The local view retains only the category state, event version, and timestamps needed for delivery and diagnosis.

### 4.5 Event contract

The event schema contains `account_id`, `event_version`, `changed_categories`, and `emitted_at`. Each changed category contains its email and push values. The producer sets the version from the committed preference row and emits one event per successful write. The consumer records the version it applied and acknowledges only after its local transaction commits.

Adding a field is backward compatible. Renaming a field or changing the meaning of a boolean requires a new event version. The contract owner is Notifications Platform, while Messaging owns the consumer implementation and its local schema.

## 5. Capacity and performance

### 5.1 Expected operating shape

The preference store and event path are designed to scale with account growth and the normal burstiness of settings traffic. Reads remain local to the caller's service or the Messaging read model, while writes are short transactions in the Settings cluster. The outbox worker can be increased independently of the API when the queue grows.

We will keep the storage schema compact and use the existing account stream rather than introduce a second transport. The design avoids synchronous fan-out, so a slow Messaging consumer does not hold an account settings request open. Capacity will be watched during rollout and adjusted as the traffic pattern becomes clearer.

### 5.2 Storage estimate

The service sheet estimates 920 bytes per preference record. At 10 million launch accounts, the row data is about 9.2 GB before indexes, write-ahead logs, replicas, and backups. The 12-month planning population is 12.5 million accounts, or about 11.5 GB of row data before those overheads. The table retains two years of current records; outbox rows follow the existing event-retention policy rather than remaining in the preference table.

The API uses the account ID as its primary lookup key. A unique account index supports the read and compare-and-swap write. We will check index size and vacuum behavior against the shared cluster's normal maintenance window before the migration is scheduled.

### 5.3 Latency and reliability

The API target is a read p95 below 120 milliseconds and a write p95 below 180 milliseconds. The write path performs one row read for the expected version, one preference update, and one outbox insert in the same transaction. The service returns a conflict without retrying a stale client write.

Sender visibility is measured from the successful write response to the first local-view application of the matching event. The target is 99 percent within 60 seconds. Queue age, event age, consumer lag, and the count of version conflicts are recorded by account cohort and rollout percentage.

## 6. Alternatives and trade-offs

### 6.1 Recommended option

The recommended option is a canonical record in Settings with an outbox event and a local Messaging view. It uses the paths that already exist, keeps the request path independent, and lets each sender read locally. It adds one schema and one event contract, but it gives the teams a clear source record and a replayable propagation path.

This option fits the operating budget and ownership boundaries. It also keeps the product's first release narrow while leaving room for a later, separately reviewed policy change.

### 6.2 Direct sender reads

The only other implementation considered is to let every sender read the Settings database directly for each delivery decision. That option would avoid a local consumer, but it would add network work to the hot delivery path and make senders dependent on the settings database's availability. It is plainly less attractive because it would increase coupling and make a database issue visible to message delivery.

For those reasons we choose the event-backed local view. The choice is straightforward for this release, and no further comparison is needed before implementation.

### 6.3 Deferred options

A separate preference service, a customer rule editor, and a shared policy engine remain deferred. They would need new ownership, additional operating cost, and evidence that customers need more than fixed category and channel choices. They are not required to deliver the first release described here.

## 7. Rollout and recovery

### 7.1 Propagation behavior

When a customer saves a change, Settings commits the new version and records a publication item in the outbox. The publisher later places a versioned preference event on the account stream. Messaging consumes that event into its local table, and the next sender lookup uses the newer version. If publication or consumption is delayed, the sender continues using the last applied state until the event arrives.

This separation means the settings request does not wait for a downstream service. It also means the source and sender can be reconciled by comparing account versions. Replayed events are safe because the local consumer keeps the greatest version it has applied.

### 7.2 Controlled rollout

The feature flag is evaluated by account ID so that one account sees a stable experience. At five percent, Account Settings will enable the new route for one observation day. The team will watch write errors, p95 latency, queue age, event age, local-view lag, version conflicts, and support reports. Expansion follows the existing release owner decision after the observation period.

The first cohort will include a mix of active and low-activity accounts without selecting on message category. Synthetic accounts will exercise both channels and all four categories. The rollout dashboard links the API, outbox, stream, and Messaging panels so an operator can follow one account version through the path.

### 7.3 Rollback and replay

Account Settings can disable the route without deleting saved records. Notifications Platform can stop new publication while leaving existing sender views available. If a consumer falls behind, the on-call engineer follows the queue-age runbook, pages the owner at 10 minutes, and uses the account-scoped replay command after the worker is healthy.

The rollout stops when the 60-second visibility target is missed for two consecutive five-minute windows. Billing and account-activity notices continue to use their prior defaults during recovery. Re-enabling the route requires a check that the event consumer is healthy and that the last applied version matches the source for a sample of accounts.

## 8. Operations

### 8.1 Signals and ownership

Notifications Platform owns API availability, request latency, source-record errors, outbox age, and event publication. Messaging owns consumer lag, local-view apply errors, stale versions, and sender lookup failures. Account Settings owns the feature flag, the save confirmation, and customer-facing support material.

The dashboard shows write-to-visibility age, queue age, event age, the percentage of changes visible within 60 seconds, and the number of accounts with a source version newer than the local version. Alerts use the existing queue-age page threshold and the rollout stop condition. Logs include account ID, event version, and correlation ID, but not addresses or device tokens.

### 8.2 Failure handling

A failed database transaction returns an error and creates no event. A publish failure leaves the outbox row for retry. A consumer failure leaves the event unacknowledged so it can be retried. An older event is acknowledged without changing the local view. A malformed event is sent to the existing dead-letter path with the account ID and version for diagnosis.

If the outbox queue grows, the operator pauses nonessential account events and scales the worker within the shared cluster's limits. The sender continues with its last known state. The account-scoped replay command can repopulate a missing local view after the consumer is healthy.

### 8.3 Operating principles

The service should be understandable to the people who operate it, and every part of the change should support a calm response when conditions differ from expectations. Clear ownership helps people find the right dashboard and keeps decisions close to the team with the relevant context. Consistent names across the API, event, and local view make the system easier to discuss in a handoff and easier to maintain over time.

Good operations depend on useful signals, sensible defaults, and a shared understanding of what the system is doing. The teams will continue to communicate during rollout and will use the same language for accounts, categories, versions, and visibility. Documentation will be kept near the service code, and changes will be discussed with the teams that depend on the event. The group values small changes, careful observation, and clear follow-through after an incident.

The design favors simple paths and avoids unnecessary surprise. When a question arises, the owner should look at the evidence available in the dashboards, compare it with the expected behavior, and record the outcome for the next person. This approach keeps the service healthy as it grows and gives the organization confidence that customer choices are treated with care.

## 9. Privacy and access

### 9.1 Account authorization

The API derives the account from the authenticated session and checks that the caller has the account-settings permission. It does not trust a caller-supplied account ID for authorization. Read and write audit records contain the account ID, actor type, result, and request correlation ID.

### 9.2 Event and data handling

Events contain no contact address, device token, or customer-written text. Database access uses the service role already approved for the Settings cluster. Messaging receives only the fields needed to choose a channel. The legal unsubscribe service remains the final authority for required mail.

## 10. Open decisions and implementation plan

### 10.1 Decisions before rollout

The teams need to confirm the final event schema with the Messaging consumer, choose the migration name, and agree on the dashboard panel ownership. Notifications Platform will document the replay procedure against the existing runbook. Account Settings will confirm the feature-flag cohort and support wording.

### 10.2 Sequence

First, implement the table, API validation, and outbox transaction behind a disabled route. Next, add the versioned consumer and local-view metrics, then run a replay test with duplicate and older events. Finally, enable the five-percent cohort for one observation day and record the decision to expand or stop.

We believe this design is ready for wider review because it uses existing boundaries, preserves the current unsubscribe behavior, and gives each team a defined rollout responsibility. Feedback on the open decisions can be incorporated before implementation begins.
