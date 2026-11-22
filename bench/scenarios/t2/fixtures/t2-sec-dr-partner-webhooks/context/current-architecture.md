# Current platform architecture

_Last updated 2025-01-18 by Platform Architecture._

The platform has a shared API edge, an Order service, an Event Router, and a Partner Delivery service. Tenants share the Order service and Event Router process, but each event retains `tenant_id` from the order transaction. Tenant identities are established by the Auth service and are not re-derived from partner credentials.

The Event Router reads committed order events from the platform stream. It currently has consumers for internal search, billing, and analytics. The proposed Partner Delivery consumer will read the same event family and create outbound deliveries. The router guarantees at-least-once publication. It does not guarantee order across different event types.

Partner Delivery runs in the platform application network. Its outbound HTTP client uses the standard egress gateway. The gateway permits HTTPS and follows DNS resolution performed by the client library. The service has no separate outbound proxy policy today. The service runs in three availability zones with a stateless API and worker deployment.

Partner configuration is stored in the Partner Registry. Registry records are tenant-scoped and include partner ID, display name, webhook URL, event subscriptions, and an opaque credential reference. Configuration changes are audited by the Registry API. The registry has no user-facing endpoint for testing a URL without saving it.

The platform's normal service-to-service identity is mTLS between named internal services. Partner Delivery authenticates to the Event Router and Registry with a workload identity. Partner endpoints authenticate inbound requests using a partner credential rather than the platform's internal identity.

Order events are immutable stream records. A stream record has an event ID, tenant ID, order ID, event type, occurred-at time, and a JSON data object. Consumers may store delivery state keyed by event ID and partner ID. There is no shared delivery-state store used by the existing internal consumers.

The public API edge has request size and rate limits, but those limits do not apply to Partner Delivery's worker egress. The egress gateway records connection status and destination hostname. Application-level delivery status is owned by Partner Delivery.
