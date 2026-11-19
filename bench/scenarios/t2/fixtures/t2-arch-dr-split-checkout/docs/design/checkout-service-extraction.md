# Checkout Service extraction proposal

**Status:** Proposed for implementation
**Authors:** Maya Chen, Commerce Platform
**Review date:** 2025-02-14

## 1. Executive summary

### 1.1 Decision requested

This proposal moves checkout from the Commerce monolith into a separately deployed Checkout Service. The service will own the checkout API, coordinate payment authorization and inventory reservation, and create the order returned to the caller. The extraction reduces monolith CPU and database pressure while giving the Commerce Platform team an independently scalable release boundary.

The team requests approval to build the service and begin a staged production rollout in the next planning cycle. The design uses existing platform capabilities where possible: the internal service mesh, PostgreSQL, the Payments API, the Inventory API, and the existing order event stream. This keeps the first release small enough to deliver in one quarter.

### 1.2 Outcomes and non-goals

The first release preserves the current customer-visible checkout token and error behavior. It does not change tax calculation, catalog pricing, fraud rules, capture timing, or the shape of the order-created event. Payment capture remains a later operation owned by Payments. Returns, subscriptions, and support tools continue to use the checkout contract while the migration proceeds.

Success means that the extracted service handles the selected production traffic with the existing checkout success rate, stays inside the service target, and permits the monolith checkout module to be retired. The team will measure CPU, database write load, response latency, authorization outcomes, reservation outcomes, and order creation rate.

## 2. Current state and boundary

### 2.1 Existing checkout path

The monolith receives an interactive checkout request, validates the cart and customer, obtains an authorization from Payments, reserves each item with Fulfillment, writes the order and its items, and emits an order-created event. Today these writes occur in one PostgreSQL transaction where the module can commit its local state together. A successful response returns an order ID. A declined authorization or unavailable item returns an error without creating a customer-visible order.

The endpoint accepts a checkout token. The token is unique for a submission, and replaying a completed submission returns its original result. The request ID and token are present in structured logs, which lets support investigate a customer report without access to application nodes.

### 2.2 Why extract now

Checkout accounts for a large share of monolith database write I/O and application CPU. The current release cadence couples payment-related changes to unrelated storefront changes, and peak traffic is expected to rise over the next year. A separate service lets Commerce Platform scale the synchronous path independently and makes its on-call signals easier to associate with checkout behavior.

The extraction also creates a clean place to add regional capacity later. It does not attempt to split the entire Commerce monolith or to replace the existing database cluster in this phase. The service will initially run in the same three regions as the public API.

### 2.3 Callers and compatibility

The public Storefront API and Mobile API will call the new service through the gateway. Both APIs continue to expose their current response fields, including `order_id`, decline codes, and the replay result for a completed checkout token. The gateway adds the service name to its route configuration without changing either public URL.

During the rollout, requests from the subscription worker, the returns reorder flow, the support console, and the partner gateway remain on the established checkout module interface. The monolith will retain a small adapter for those internal paths, and those callers can move when their owning teams schedule the change. This means the initial traffic split can be limited to the two interactive APIs while the other integrations remain stable.

The adapter maps the legacy error names to the service's internal status values. It also carries the request ID and checkout token into the service request. Client libraries will be updated alongside the gateway route, so callers do not need to know whether the primary implementation is in-process or remote.

### 2.4 Constraints and assumptions

The service must use the existing mesh identity and deployment platform. Payments and Fulfillment keep their APIs and their current on-call responsibilities. Customer data is available through the account platform, and the checkout request contains a customer ID and a shipping address snapshot. The first version must support the three current regions and the holiday traffic forecast without a new message broker.

The 700 ms request timeout is a hard upper bound for the public endpoint. The service is expected to run at the current weekday peak initially, with headroom for the next twelve months. A service-level availability target of 99.95% applies to the complete response seen by the caller.

## 3. Proposed service design

### 3.1 API and request model

The Checkout Service exposes `POST /v1/checkouts` and accepts a cart, customer ID, shipping snapshot, checkout token, currency, and request ID. The service validates required fields and calculates a request fingerprint from the token and cart. A repeated token returns the stored result if the fingerprint matches; a mismatched fingerprint returns a conflict. This preserves the monolith's replay behavior and prevents a token from being reused for a different cart.

The response contains the order ID, an authorization status, and a stable error code when the operation does not succeed. The gateway translates internal errors into the public API's legacy error names. A request that cannot receive a definitive provider result is reported as pending and remains visible to the reconciliation worker rather than being reported as a successful order.

The service uses a small state machine: `received`, `authorizing`, `reserved`, `ordered`, `declined`, and `needs_reconciliation`. State changes include the checkout token and request ID. A unique token index prevents two concurrent requests from creating separate order records for one submission.

### 3.2 Persistence and order records

The first implementation keeps the existing PostgreSQL cluster and the existing relational model. The service uses a dedicated database role and writes checkout state to `orders`, `order_items`, `payment_attempts`, and `inventory_reservations`. It also reads the `customer` row when it needs a customer display or address value. Keeping the schema familiar avoids a data conversion project and allows existing reporting queries to continue during the rollout.

The service owns the SQL access layer for these records. It will use prepared statements, explicit transaction boundaries, connection pooling, and a migration tool checked into its repository. The initial migrations add a service metadata column and indexes for token lookup and reconciliation. Database changes are reviewed by Commerce Platform and applied in the same release sequence as the service.

A successful order event is published after the order write is committed. The event includes the order ID, customer ID, total, and item identifiers but no payment credentials. A background publisher retries event delivery and records its last attempt so a broker interruption does not block the public response.

### 3.3 Customer information

The service needs the customer ID, a shipping address snapshot, and the customer's current display email for its order confirmation. It will read the profile from the account platform when the request does not include a usable snapshot. The existing `customer` row remains available to the service for the transition period, and the profile API will be added to the service client library.

Customer profile fields change less often than checkout traffic, so a five-minute cache keyed by customer ID will reduce repeated profile calls. The cache holds only the display email and address fields and is invalidated when the service receives a profile-updated event. Order records retain the address snapshot used at purchase time.

The customer data arrangement will be finalized during implementation with Customer Foundations and Commerce Platform. Both teams will review fields before launch, and the service will document the fields it requires in its API contract. This approach avoids delaying the extraction while the teams settle on the long-term shape of the account boundary.

### 3.4 Checkout workflow

The request coordinator validates the token, asks Payments to authorize the total, asks Fulfillment to reserve the requested quantities, and writes the order after both responses succeed. The calls are made in that order because the authorization amount depends on the validated cart and the reservation needs the final order identity. The coordinator stores the state after each successful step so a worker can continue an operation that did not finish in the request.

If Payments declines, the service returns the mapped decline code. If Fulfillment reports insufficient stock, the service returns the existing stock error and leaves the cart available for another attempt. If the order write fails, the worker retries the write using the token's unique constraint. The event publisher runs after the order transaction and does not change the response status.

The coordinator exposes a seven-second internal workflow budget while the public request has a 700 ms timeout. Operations that outlive the request are completed by the reconciliation worker and presented as pending when needed. The worker polls outstanding records every minute and uses the same state machine as the request path. Operators can inspect an operation by request ID, checkout token, or order ID.

### 3.5 Events and downstream behavior

The service publishes `CheckoutAccepted` after an order reaches `ordered`. The existing event consumer translates this to the current order-created event for catalog analytics, fulfillment notifications, and customer messaging. Event payloads retain the current order ID and item identifiers, so downstream consumers do not need a simultaneous migration.

Events carry a version field. A consumer that does not recognize a new optional field ignores it. The service retains accepted events for seven days for replay into a newly deployed consumer. The event publisher reports delivery delay and rejected payloads to the Commerce Platform dashboard.

## 4. Performance and capacity

### 4.1 Target and sizing model

The public checkout endpoint has a p99 target of 450 ms and a hard request timeout of 700 ms. Initial sizing uses 180 requests per second at the weekday peak and 120 in-flight requests per pod. Three service replicas, one per zone, provide capacity for a zone loss while retaining the normal peak rate. Horizontal scaling adds replicas when CPU is above 65% for five minutes or when the in-flight queue grows.

Capacity tests will use the 12-month projected peak and a seven-item cart at p95 cart size. The test will include provider latency, inventory contention, database connection saturation, and event publication. The service will be deployed with a minimum of three replicas and a maximum of 20 until production measurements establish a better limit.

### 4.2 Request timing

The expected synchronous path is 70 ms for validation and local work, 140 ms for the Payments API, 110 ms for Fulfillment, 80 ms for the order write, and 40 ms for gateway and mesh overhead. These values total 440 ms at p99, leaving a small margin under the 450 ms target. The calls to Payments, Fulfillment, and the order writer are kept as separate stages so each stage has a clear timeout and metric.

The gateway enforces the existing 700 ms timeout. Payments has a 300 ms client timeout and Fulfillment has a 200 ms client timeout. When a dependency reaches its timeout, the service returns the corresponding stable error or pending result. The timing dashboard will show each stage and the complete public response, allowing capacity decisions to use observed p99 rather than averages.

### 4.3 Resource and cost estimate

At weekday peak the service is estimated to need three 2-vCPU, 4-GB replicas plus a small worker pool. Database connections are capped at 40 per replica, with a separate pool for reconciliation. The extracted service adds approximately 6 vCPU and 12 GB memory at baseline. The team has budgeted 1,200 compute units per month and will review the estimate after the first load test.

Database storage grows by approximately 18 GB per month at the current order rate. Indexes on checkout token, order status, and reconciliation state are included in the estimate. A weekly review will compare actual storage and connection utilization with these assumptions.

## 5. Delivery and migration

### 5.1 Rollout sequence

The implementation is split into API, persistence, and traffic changes. First, the service runs in all three regions with synthetic health checks. Next, the gateway sends 1% of Storefront API traffic to it for 30 minutes, then 5% for two hours, and finally 10% for one business day. The rollout dashboard shows success rate, response p99, payment outcomes, reservation outcomes, database errors, and event delay.

After the 10% stage meets the target, the team increases traffic in 10-point steps during staffed hours. The gateway retains the monolith route, so an operator can change the route percentage back to zero. Each stage has an owner and a written start time in the release record. The service is considered ready for general traffic when it has completed one weekday and one peak-period observation at the target.

The initial rollout selects Storefront traffic because it has the largest volume and an owner available for live verification. Mobile traffic follows after its client library update. Remaining callers are migrated after the service has demonstrated stable order and event metrics.

### 5.2 Data migration and release order

No historical orders are copied. The service reads current records during the transition and creates new order state for requests it handles. Database migrations are backward compatible with the monolith version: new nullable metadata is added first, the service is deployed second, and removal of unused indexes is postponed until the monolith path is retired.

The release pipeline runs schema checks, API contract tests, and a replay test with a completed checkout token. It also verifies that events contain the same order ID and item set as the current event. Database migrations are applied once by the release job, not independently by each service replica.

### 5.3 Rollback and operator controls

The gateway route percentage is the primary rollback control. Returning it to zero sends new requests to the monolith. Existing service requests are allowed to finish up to the public timeout, and the reconciliation worker continues to process operations that already received a provider response. Operators can pause the worker, disable new traffic, or replay a known request by checkout token.

A release is stopped when availability, p99, error rate, or event delay crosses its target for two consecutive five-minute windows. The release owner records the decision and opens a follow-up for any orders in a pending state. Database changes are additive during the rollout, so the previous monolith revision can run while the service is disabled.

## 6. Reliability and operations

### 6.1 Dependency handling

Payments and Fulfillment are remote dependencies with explicit client timeouts. The service uses bounded connection pools and circuit breakers so a slow dependency does not consume every request slot. A payment decline is a business response, while a provider timeout is an unknown outcome that enters reconciliation. Inventory timeouts return a temporary error unless a reservation result is already durable.

The service emits counters for each dependency result and histograms for each stage. Alerts cover public availability, p99, dependency timeout rate, pending operations older than ten minutes, and event publication delay. The on-call runbook links a request ID to its state, provider reference, reservation, and order event.

### 6.2 State recovery

The reconciliation worker claims records with a lease and renews the lease while it works. A lease expires after five minutes, allowing another worker to continue after a pod failure. State transitions include the previous and next state, timestamp, request ID, and reason. The worker does not create a second order when the token already has an ordered record.

A daily report lists operations that remain pending for more than one hour, reservations near expiry, and events that have not been acknowledged by the broker. Commerce Platform owns the service dashboard and the worker. Payments and Fulfillment receive their dependency-specific alerts through their existing channels.

### 6.3 Provider retries

Transient network errors from Payments are retried once with a two-second delay. A retry uses the payment attempt ID generated for the checkout and records the attempt outcome. If the second request also fails, the checkout is marked `needs_reconciliation` and the caller receives a pending response. Fulfillment requests use the reservation ID in the same way, allowing a retry to find an existing reservation.

The worker reconciles pending authorizations by querying Payments with the attempt ID. Successful authorizations continue to reservation and order creation; declined authorizations close the checkout with the mapped decline. The service does not retry a request after the workflow has reached `ordered`.

### 6.4 Observability

Every request has a request ID and checkout token in logs, traces, and state records. The service propagates the trace context through the mesh and attaches the order ID when one exists. Logs contain status, latency, dependency name, and a reason code, but not card data or full customer addresses.

Dashboards are grouped by region, caller, outcome, and dependency. The release dashboard compares the service with the monolith baseline for success rate and p99. Support receives a search view for token, request ID, and order ID, with access controlled through the existing support role.

## 7. Security and data handling

### 7.1 Service identity

The gateway authenticates callers with the mesh identity and forwards the customer identity claims. The Checkout Service accepts requests only from the gateway, the subscription worker adapter, and the support adapter. Payments and Fulfillment authorize the Checkout Service identity separately. Production credentials are delivered by the deployment platform and are not stored in the repository.

The service validates customer access before using a customer ID and rejects a request whose customer identity does not match the authenticated caller. Support retries require an operator identity and a reason code. Audit records retain the operator, request ID, and result.

### 7.2 Sensitive fields

The service never receives primary account numbers. It stores provider references and authorization status, and it redacts those references from ordinary application logs. Customer email and shipping snapshots are encrypted at rest using the database platform's existing key. Access to production data follows the Commerce Platform and support roles.

Retention follows the existing order record policy. The service deletes temporary request records after reconciliation or after the retention window, while order snapshots remain with the order record. Export and deletion requests are forwarded to the account platform for customer profile data.

## 8. Ownership, rollout readiness, and decision

### 8.1 Operating ownership

Commerce Platform owns the Checkout Service, its deployment, public SLO, and reconciliation worker. Payments owns authorization behavior and provider credentials. Fulfillment owns reservations and stock decisions. The gateway team owns the route configuration and can perform the traffic rollback with Commerce Platform on call.

Before each rollout stage, the release owner confirms staffed coverage for Commerce Platform, Payments, Fulfillment, and gateway operations. The service runbook includes escalation links, dashboards, deployment controls, and the process for resolving pending checkouts.

### 8.2 Test and acceptance plan

Automated tests cover validation, replay, declined payment, stock shortage, provider timeout, worker recovery, and event delivery. Contract tests run against Payments and Fulfillment stubs and verify timeout and error mappings. Load tests cover weekday and projected peak traffic with seven-item carts.

Acceptance requires the public p99 target, error-rate target, replay behavior, matching event payloads, and a successful rollback drill. The team also verifies that a zone loss leaves enough capacity for the weekday peak and that support can find an operation by request ID and token.

### 8.3 Recommendation

The proposed boundary gives checkout an independent release and scaling unit without changing the public API or downstream event contract. The staged gateway rollout, additive schema changes, worker recovery, and operational dashboards keep the migration reversible. The design is ready for implementation, with the listed acceptance tests gating the first customer traffic.

## 9. Appendix: request example

### 9.1 Example request and response

A request contains a customer ID, a checkout token, a cart, currency, and a shipping snapshot. A successful response contains `order_id` and `status: accepted`. A replay with the same token returns the same order ID. A provider timeout returns `status: pending` and the request ID used by the reconciliation worker. The gateway translates the internal response into the versioned public response expected by Storefront and Mobile clients.
