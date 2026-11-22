# Team constraints and ownership

Account Settings can schedule one production schema migration during the quarterly release window. The team will not accept a new synchronous dependency from the settings request path to Messaging. Its on-call rotation supports the existing database and outbox worker, but not a new policy service.

Messaging requires a versioned preference event with account ID, event version, changed categories, and an emitted-at timestamp. The consumer must tolerate retries and out-of-order events from a replay. The event must not contain an email address or a device token.

The monthly operating budget for this change is 1,800 USD at launch. A separate policy engine would need an owning team and a cost review. Account Settings owns the customer-facing save confirmation. Notifications Platform owns the API, schema, and outbox publication. Messaging owns its consumer and local read model.

The rollout must begin at five percent of eligible accounts and remain there for one observation day before expansion. Rollback means disabling the settings route and stopping new preference events; existing sender views remain available while the teams repair or replay data.