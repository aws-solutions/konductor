# Partner event delivery by webhook

**Status:** Proposed for pilot

**Authors:** Partner Integrations and Platform Reliability

**Last updated:** 2025-01-20

## 1. Summary

Partner companies need order status changes without repeatedly polling the platform API. This design adds a Partner Delivery service that consumes committed order events, selects subscribed connections, and delivers versioned JSON webhooks over HTTPS. It stores delivery state, retries temporary failures, and exposes a small operations view for Partner Operations.

The first pilot covers order status events for three existing tenants and four partners. The service uses the existing Event Router, Partner Registry, workload identity, and egress gateway. It does not change order writes or the public API edge. The design favors a small stateless worker service and a single delivery path so the team can operate it with the current platform skills.

The pilot is ready for implementation after the review. The main choices are intentionally straightforward: HMAC authentication, bounded retries, a versioned payload profile, and an append-only delivery record for support investigations.

## 2. Goals and non-goals

### 2.1 Goals

The service will deliver an order status notification within the partner tier target after the Event Router publishes the source event. It will support tenant-scoped partner connections, at-least-once delivery, configuration changes through the Partner Registry, and a clear status for every delivery attempt. It will make delivery behavior visible without requiring operators to inspect worker hosts.

The pilot will handle the current event rate and leave room for the forecast growth. Partner Integration engineers will own the service, while Reliability will own worker capacity and alerts. Partner Operations will own partner onboarding and endpoint support.

### 2.2 Non-goals

This phase does not provide a general outbound HTTP platform, arbitrary event transformation, or a partner-facing event replay console. It does not promise exactly-once processing by a partner. Partners remain responsible for acknowledging requests quickly and deduplicating event IDs.

## 3. Proposed design

### 3.1 Event flow

The Event Router publishes a committed order event with `event_id`, `tenant_id`, `order_id`, event type, occurred-at time, and the event data object. Partner Delivery consumes the stream and looks up active connections for the event's tenant. For each matching connection, it creates a delivery record keyed by connection ID and event ID.

A scheduler places due delivery records on the delivery queue. A worker loads the connection configuration, builds the profile payload, signs it, and sends an HTTPS POST. The worker records the response class and next attempt time. A 2xx response is accepted. A timeout, connection failure, or 5xx response is temporary. Other 4xx responses are terminal except 408 and 429, which are temporary.

The source event remains available in the Event Router retention window. The delivery record contains enough identifiers to relate an attempt to the source event without copying the entire source record into the queue.

### 3.2 Destination registration

A partner administrator supplies a webhook URL in the Partner Registry. The Registry API validates that the value is a syntactically valid HTTPS URL and stores the URL exactly as entered. URLs may include a port and path so a partner can route several profiles through one gateway. The sender resolves the hostname when it opens each connection and uses the standard platform egress gateway.

Partner Operations can update the URL from the connection detail page. The next due attempt uses the newest saved value. A configuration change creates an audit event with the connection ID, actor, old URL, and new URL. The service does not make a request during registration; the first network request occurs when an order event is due.

This keeps partner onboarding independent of the availability of the partner's endpoint and avoids a separate connectivity test that could slow the registry API. HTTPS certificate validation remains enabled in the HTTP client.

### 3.3 Request authentication

Each request body is serialized as UTF-8 JSON and signed with HMAC-SHA256. The signature is sent in `X-Partner-Signature` as a lowercase hexadecimal digest. Partners compute the digest over the exact bytes received in the body and compare it using a constant-time comparison.

The request includes `X-Partner-Event-Id`, `X-Partner-Connection-Id`, and `X-Partner-Profile`. These headers help the partner identify duplicates and route the event. The authentication input is only the request body. The service does not modify the body after signing, and it treats a successful HTTP response as acceptance of the signed request.

A connection credential is generated when a connection is created and stored as an encrypted reference in the Partner Registry. Partner Operations can revoke a credential from the operations page. Revocation prevents future sends after the next configuration refresh.

### 3.4 Credential storage and scope

To keep deployment configuration simple, Partner Delivery reads `WEBHOOK_SIGNING_SECRET` from its environment at startup. The same value is used to sign requests for every connection in the pilot. The Partner Registry stores an opaque credential reference for compatibility with the existing configuration model, but the worker does not need to fetch a separate value for each connection.

The secret is held in the platform secret store and is available only to the Partner Delivery workload identity. It is never returned by the Registry API or included in the operations view. Access to update the deployment secret is limited to the Partner Integrations on-call group. The environment variable is loaded once when a worker starts.

This arrangement avoids a lookup on every attempt and gives the pilot one simple secret rotation procedure. Partners receive the secret through the existing onboarding handoff. The team will add a per-connection credential model if a later product phase needs it.

### 3.5 Payload profile

The pilot sends `order.status.v1` as a JSON object with the following shape:

```json
{
  "event_id": "evt_123",
  "tenant_id": "tenant_456",
  "order_id": "ord_789",
  "status": "shipped",
  "occurred_at": "2025-01-20T13:15:00Z",
  "customer_name": "Example Customer",
  "customer_email": "sample-value",
  "shipping_address": {
    "street": "10 Example Way",
    "locality": "Exampletown",
    "postal_code": "00000",
    "country": "US"
  },
  "currency": "USD",
  "total_amount": "42.00"
}
```

The profile is assembled from the event object and the order read model. A partner subscription to `order.status.v1` receives the complete profile. `total_amount` is omitted if it is unavailable in the read model. The profile is versioned so fields can be added in a future version without changing existing consumers.

The event ID and order ID give partners enough context to reconcile a notification with their own system. Customer contact and shipping details make the notification useful for fulfillment partners without requiring a second API call.

### 3.6 Credential changes

The worker reads the deployment secret during process startup and keeps it in memory. A credential update is applied by changing the deployment's secret reference and restarting the Partner Delivery pods. The deployment uses a rolling restart with two unavailable pods allowed at a time. New pods use the new value, while old pods finish their current HTTP request before exiting.

Partner Operations will coordinate a credential change with the affected partners. The runbook records the deployment version, change actor, and time. A revoked connection is skipped after its registry cache expires, which is set to five minutes.

The initial pilot has no scheduled credential changes. If an urgent change is needed, Reliability can restart the deployment from the operations console. Delivery records remain pending while workers are replaced and resume after the rollout completes.

### 3.7 Scheduling and retries

The service uses one durable queue named `partner-delivery`. Every connection in every tenant writes due delivery records to this queue. Twelve worker pods poll the queue and claim records with a lease. The scheduler orders records by `next_attempt_at`, then by creation time.

A request is attempted immediately, then after 30 seconds, 2 minutes, 10 minutes, 30 minutes, and 2 hours. The maximum age of a delivery record is 24 hours. A record that reaches the age limit receives terminal status `expired`. A 429 response uses the same schedule as other temporary responses.

The queue has a maximum depth alarm at 100,000 records. Workers use a 10-second HTTP timeout for all connections. The deployment can scale to 60 worker pods based on queue depth. Because all records use the same claim path, a worker can process any connection and the capacity pool is shared across the pilot.

The single queue reduces operational objects and makes capacity utilization predictable. The scheduler's due-time ordering gives older failures priority over newly created records. The team will review the retry durations after the pilot has two weeks of delivery data.

### 3.8 Delivery records and logs

Each attempt writes a delivery record with connection ID, tenant ID, event ID, destination hostname, attempt number, request and response timestamps, HTTP status, response size, and the serialized request payload. Records are stored in the Partner Delivery database and in the application log for correlation. The database keeps these records for 365 days to support partner disputes and annual account reviews.

The payload is encrypted at rest with the platform database key. Access is restricted to Partner Integrations and Reliability through the normal production access group. The operations page masks customer email and shows only the first 12 characters of the event ID. Full records remain available through a support export for users with the audit role.

Logs use JSON and include a correlation ID. A log shipper sends application logs to the central log store, where they are searchable by tenant, connection, event ID, and outcome. The log store follows its standard one-year retention setting.

### 3.9 Idempotency and partner behavior

Partners should treat `event_id` as the idempotency key. A timeout after the platform sends a request can result in a later duplicate. The delivery service does not attempt to determine whether a partner processed a request before retrying. The partner's 2xx response is the acceptance boundary.

The service does not guarantee ordering between status events. It includes `occurred_at` and event ID so a partner can compare updates. A partner that needs strict ordering must use the order API as the source of truth during reconciliation.

### 3.10 Observability

Metrics include events consumed, due records, attempt count, response class, accepted age, queue depth, and terminal outcomes. Dashboards group by partner and connection. Alerts fire for consumer lag, queue depth, worker error rate, and the percentage of records older than the tier target.

Structured logs carry the event ID and connection ID. Operators can use the operations view to pause a connection, revoke its credential, change its endpoint, and inspect the last 50 attempts. The view does not show request bodies.

## 4. Capacity and failure handling

### 4.1 Capacity estimate

The current peak is 180 events per second for 90 seconds. The pilot estimate assumes 40 percent of events match at least one partner connection and an average HTTP round trip of 250 milliseconds. At 12 workers with 20 concurrent requests per worker, the initial deployment has 960 requests per second of theoretical request slots. This leaves headroom for the current peak and permits a 55 percent annual event increase before a capacity review.

The worker limit of 60 pods is a hard deployment limit. Reliability will compare queue age and accepted age to the tier target during the pilot. Cloud spend is expected to stay within the monthly worker budget because normal load uses the initial pod count and autoscaling adds pods only while the queue remains above its target depth.

### 4.2 Partner failures

Connection failures and 5xx responses follow the retry schedule. A partner returning 429 is treated as temporary. A sustained failure eventually produces `expired`, which Partner Operations can export for reconciliation. The service does not retry a terminal 4xx response because the partner must change its request expectations or configuration first.

The worker releases a lease when an HTTP attempt completes or its timeout expires. The lease duration is 30 seconds longer than the request timeout. A crashed worker's lease becomes available after the lease duration, allowing another worker to continue the record.

### 4.3 Platform failures

If the Event Router is unavailable, the consumer stops acknowledging stream records and resumes from its last committed position. If the Partner Delivery database is unavailable, workers stop claiming records and the scheduler reports an error. The service runs in three availability zones and uses the platform's managed database backup schedule.

A deployment rollback restores the previous worker image. Delivery records are compatible across the initial schema versions. Configuration changes made during a rollback remain in the Partner Registry and are read after the worker starts.

## 5. Security and privacy operations

### 5.1 Access control

Only tenant administrators can create or edit their connections. Partner Operations can view connection status and perform operational actions. Reliability can change deployment configuration and manage worker capacity. All administrative actions produce audit events in the Partner Registry.

The Partner Delivery service uses workload identity for Event Router and Registry access. It has no write permission to orders. Database access is limited to delivery tables and the migrations needed by the service.

### 5.2 Incident response

The on-call can pause a connection, revoke its credential, and stop workers from the operations console. A destination change or elevated failure rate is investigated using connection audit events, egress gateway records, and delivery status. Partner Operations owns communication with the affected partner and tenant.

The service records destination hostname and response status for each attempt. Incident exports include the connection ID, tenant, event IDs, destination, timestamps, and response classes. The incident lead decides whether to notify affected tenants under the platform communication policy.

## 6. Rollout and acceptance

### 6.1 Pilot plan

The team will deploy the consumer disabled, create connections for three tenants, and run synthetic events through the staging partner endpoints. After a one-day observation window, it will enable production delivery for one starter connection, then one growth connection, and finally the enterprise connections. The team will compare accepted age, queue depth, error classes, and worker cost at each step.

Partner Operations will provide onboarding instructions and a sample verifier. The sample verifier will show the event ID, verify the HMAC body digest, and return a 2xx response. No production customer data will be used in the staging exercise.

### 6.2 Acceptance criteria

The pilot is accepted when the service consumes events without increasing Event Router lag, maintains the partner tier acceptance target for seven days, and produces an operations record for every attempt. Reliability must confirm that autoscaling remains below the worker limit and that the monthly cost forecast is within budget.

Partner Operations must demonstrate connection pause, endpoint update, credential revocation, and reconciliation of an expired delivery. The team will document any partner-specific timeout or response behavior discovered during the pilot.

## 7. Open decisions after pilot

### 7.1 Profile expansion

The team will use partner feedback to decide whether to add invoice and fulfillment profiles. Each new profile will be versioned and documented before onboarding.

### 7.2 Delivery history

The team will decide whether partners need a self-service history view or export API. The pilot operations view is sufficient for the initial support workflow.

### 7.3 Capacity ownership

Reliability and Partner Integrations will review the two-week capacity report and choose whether to adjust the autoscaling target, worker limit, or queue storage tier. Any change will include a new cost estimate and updated acceptance target.
