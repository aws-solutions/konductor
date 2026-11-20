# Harborline webhook relay threat model

## Data-flow observations: notes

The partner request crosses EdgeGateway and reaches InboundReceiver with a body, an authorization value, and an HMAC header. ApiKeyAuthenticator resolves a partner and account, while SignatureVerifier checks the body digest. The receiver then stores the envelope and creates work for callbacks. The current flow uses the account label in the JSON envelope for the stored event and subscription selection, rather than making the authenticated account the only source of tenant identity.

CallbackRegistry accepts a customer destination and DeliveryForwarder uses that destination later, from a shared worker. This means callback registration is also a network-egress boundary. A customer-controlled URL cannot be treated as an ordinary presentation field. It needs validation at registration and again at connection time because DNS and redirects can change where a name leads.

EventStore keeps complete event bodies for reconciliation. AuditLogger receives request data and configuration-related startup information. RetryScheduler uses one queue for every account and the current configuration combines a body that has no stated size ceiling with retry work that has no per-tenant budget. AdminApi is an especially sensitive control plane because replay and key provisioning can affect stored customer events and future authentication.

## Priority and response: notes

The first release should not accept production traffic until the authenticity and destination controls are corrected. A forged event can create customer-visible deliveries, and an unrestricted callback can turn a normal delivery worker into a path to private services. Tenant binding must be corrected in the same release because an authenticated partner must not be able to select another account by changing JSON. The remaining findings should have owners and target dates before onboarding. The operations team should keep request ids and delivery ids while fixing these areas so the changes can be verified in staging.

The findings below describe the design behavior, the affected boundary, and a practical treatment. Severity reflects likely customer impact and ease of abuse in a multi-tenant service, not just whether an attack requires an already compromised internal host.

## Scope: notes

This review covers the partner event path from EdgeGateway through InboundReceiver, ApiKeyAuthenticator, SignatureVerifier, EventStore, CallbackRegistry, RetryScheduler, DeliveryForwarder, AuditLogger, and AdminApi. It also covers the database and the shared delivery queue because those components carry customer payloads or determine who can cause work to happen. The review uses the design and API documents as the source of truth, including the prototype where it makes an implementation choice concrete.

The service has useful boundaries already. EdgeGateway terminates public TLS and re-encrypts the private hop. PublicRateLimiter limits broad request bursts. QueryLayer binds database values through a parameterized query interface. Those controls reduce their respective exposures, so this review does not treat them as high-severity findings. They do not, however, address the application identity, destination, data lifecycle, or resource-allocation decisions below.

## Recommended order: notes

First, reject requests unless the raw body has a valid signature, compare digests with a constant-time operation, and enforce a bounded timestamp and event-id replay window. Second, derive the tenant only from the authenticated key and verify every downstream query and callback selection against that identity. Third, constrain callbacks to an explicit customer-approved destination policy, block private and instance metadata address ranges after resolution, disable redirects or revalidate every hop, and enforce egress rules. Then add body and queue budgets, replace the shared operations credential, and establish encryption and deletion jobs with observable completion.

A staging exercise should cover a forged signature, a stale signed request, a duplicate event, a body with a conflicting tenant, an internal callback URL, a redirect to a private address, a large body, and a tenant that has reached its retry budget. The exercise should inspect database rows and logs as well as HTTP responses. The retention job should be tested against an old synthetic event and its backup behavior should be documented separately.

```json
[
    {
        "mitigation": "Verify the raw request bytes before using the event, reject missing or malformed signatures, compare equal-length digests with a constant-time primitive, and fail closed. Keep partner secrets in a dedicated secret store and rotate them through a controlled key version transition.",
        "severity": "critical",
        "threat": "Inbound events can be accepted without effective signature verification, and the HMAC is compared with an ordinary string comparison rather than a constant-time compare. An attacker who can reach the endpoint may forge accepted partner events or use timing information to learn the signature.",
        "component": "SignatureVerifier / InboundReceiver"
    },
    {
        "mitigation": "Require a signed timestamp within a bounded clock-skew window and record event ids per authenticated tenant for the acceptance window. Make the event-id insert atomic so concurrent duplicates create one accepted event and return an idempotent result.",
        "severity": "high",
        "threat": "There is no replay protection. A valid signed request can be sent again because the design does not enforce a timestamp freshness window or retain event ids for duplicate detection.",
        "component": "InboundReceiver / SignatureVerifier"
    },
    {
        "mitigation": "Allow only destinations that satisfy an explicit callback policy, resolve and reject loopback, link-local, private, and metadata ranges, enforce an egress firewall, and disable redirects or validate every redirect hop. Recheck the destination at delivery time.",
        "severity": "critical",
        "threat": "A customer callback URL is used as an unrestricted outbound destination. The forwarder can be directed to internal services or a cloud instance metadata endpoint, and redirects can move a seemingly safe URL to a private address. This creates a server-side request forgery path from a shared worker.",
        "component": "CallbackRegistry / DeliveryForwarder"
    },
    {
        "mitigation": "Derive tenant id only from the authenticated key context and ignore or reject a conflicting body field. Pass the authenticated tenant through every store, query, callback lookup, and administrative authorization check, with cross-tenant tests.",
        "severity": "high",
        "threat": "The authenticated partner key identifies one account, but the receiver takes tenant identity from the request body for storage and subscription selection. A caller can change the body tenant id and cause cross-tenant event placement or delivery.",
        "component": "ApiKeyAuthenticator / InboundReceiver"
    },
    {
        "mitigation": "Log event and request identifiers, sizes, outcomes, and allowlisted metadata instead of bodies, authorization values, or signing secrets. Redact sensitive fields before serialization, restrict log access, and rotate or revoke any credential that was previously emitted.",
        "severity": "high",
        "threat": "Request records include full event payloads, and startup configuration logging can include partner signing secrets. Logs therefore become a second copy of customer data and credentials for every collector, operator, and retained archive that can read them.",
        "component": "AuditLogger"
    },
    {
        "mitigation": "Set and enforce a body-size limit before buffering, cap stored payload size, give each tenant bounded queue and retry budgets, apply fair scheduling and backpressure, and meter rejected work. Set a hard maximum attempt count with a dead-letter or operator-visible terminal state.",
        "severity": "high",
        "threat": "The event body has no maximum payload size and retry work has no per-tenant limit. One tenant can submit large events or create repeated callback failures and consume the shared queue, memory, worker time, and database capacity needed by other tenants.",
        "component": "RetryScheduler / DeliveryForwarder"
    },
    {
        "mitigation": "Use individually issued, scoped operator credentials or short-lived workload identity, support overlapping key rotation and immediate revocation, require the private network boundary as an additional control, and write tamper-evident audit records containing actor, action, target, time, and result.",
        "severity": "high",
        "threat": "All operations use one shared administrator API key. The key has no rotation workflow and admin actions have no durable audit trail that identifies the human or service actor, so compromise cannot be contained or reliably investigated.",
        "component": "AdminApi"
    },
    {
        "mitigation": "Enable database and backup encryption with separately managed keys, minimize sensitive fields where possible, and run an observable deletion or purge job that removes events and delivery data after thirty days. Align backup expiry with the retention policy and alert when old rows remain.",
        "severity": "high",
        "threat": "Stored event bodies are not encrypted at rest by the design, and the promised thirty-day retention is not enforced by an automatic deletion job. Complete customer payloads can remain indefinitely in the primary database and its ordinary copies.",
        "component": "EventStore"
    }
]
```
