# Design review: Checkout Service extraction

The proposal has a useful staged deployment shape and preserves important client behavior, but it is not ready for customer traffic. The central boundary is incomplete: the service is a new process with old teams' tables and no settled customer-data authority. The workflow also moves a transaction that was local to several remote operations without specifying how compensation and reconciliation prevent a charge, reservation, or order from being left behind.

The performance case is optimistic compared with the packet's measured component timings. The migration plan can route traffic back to the monolith, but it has no same-request comparison stage, so it cannot establish behavioral equivalence before increasing exposure. Finally, the design leaves several existing callers in an indefinite adapter state and repeats the provider retry shape that caused the prior duplicate authorization incident.

## Findings

### 3.2, critical
The service directly writes `orders`, `order_items`, `payment_attempts`, and `inventory_reservations`, despite those tables being owned by other teams in the context. That makes the extraction a process split over shared storage, preserves schema coupling, and conflicts with the rule that a service may not use another team's production credentials. Define a service-owned schema or an API/event-based handoff, and stop direct writes to those tables before production traffic.

### 3.4, critical
Authorization, reservation, and order creation are separate steps, but the proposal only describes retrying the order write. A reservation can remain held after an order failure, and an authorization can succeed while reservation fails; the seven-second workflow budget and a state machine do not compensate those outcomes. Define a durable saga with explicit compensating actions, reconciliation states, ownership, and operator handling for each partial-failure boundary.

### 4.2, high
The document's 440 ms sum is inconsistent with `service-targets.yaml`: the listed p99 components are 70 + 55 + 190 + 155 + 85 = 555 ms before any additional queueing or variance. The three serial network hops therefore exceed the 450 ms public p99 latency budget. Rework the latency budget from measured p99s, parallelize independent work where the contract permits it, or remove a hop and prove the result with load tests.

### 5.1, high
The rollout changes the primary implementation at 1%, 5%, and 10%, then relies on dashboards and a historical monolith baseline. It never sends a non-authoritative shadow request or otherwise runs both paths on the same input and compares response, order, payment, reservation, and event results. Add a side-effect-safe dual-run or shadow-traffic phase with explicit comparison and exit criteria before expanding customer traffic.

### 3.3, medium
The proposal says Customer Foundations and Commerce Platform will finalize the customer arrangement during implementation, while also reading the legacy customer row and caching profile fields. The context says Customer Foundations owns that table and approves new writers, so the design needs an ownership decision rather than a future agreement. Assign the owner, state whether the service is read-only, and document the customer-table migration or API contract before launch.

### 2.3, high
The call graph includes subscription renewal, returns reorder, support retry, partner checkout, and the reservation worker, but the proposal only says that they will remain behind a small adapter and migrate when their teams schedule it. There is no caller inventory with an owner, contract test, compatibility deadline, or retirement path. Publish a migration plan for each caller, name the adapter owner, and make monolith removal depend on those paths being moved or explicitly retired.

### 6.3, medium
The design retries with a locally generated payment attempt ID, but the incident context says that this did not deduplicate a provider request and that the provider offers a 24-hour idempotency key. The proposal also does not durably record the provider request before retrying. Send a stable provider idempotency key for the checkout operation, persist a durable retry record before the call, and deduplicate or reconcile uncertain outcomes before another authorization.

## Additional questions for implementation

The design should define how it sheds load when Payments or Fulfillment slows down, including which requests are rejected first and how pending work is bounded. It should publish the service-to-service authorization matrix and prove that gateway claims cannot be replaced with an arbitrary customer ID. The API contract needs an explicit version and deprecation plan for the callers that remain on the adapter. The release record should name the on-call owner for the public SLO and state how error-budget decisions affect rollout speed.

```json
[
  {
    "location": "3.2",
    "severity": "critical",
    "issue": "The extracted service directly writes tables owned by Order Platform, Payments, and Fulfillment, so the split preserves shared-storage coupling and violates the stated ownership boundary.",
    "fix": "Use a service-owned schema or API/event handoff and stop direct writes to the old tables before production traffic."
  },
  {
    "location": "3.4",
    "severity": "critical",
    "issue": "Payment authorization, inventory reservation, and order creation have no defined compensation contract for a later-step failure.",
    "fix": "Define a durable saga with compensating actions, reconciliation states, and operator handling for every partial-failure boundary."
  },
  {
    "location": "4.2",
    "severity": "high",
    "issue": "The stated 440 ms total conflicts with the context p99 components, which sum to 555 ms before queueing and exceed the 450 ms latency budget.",
    "fix": "Recalculate the latency budget from measured p99s, parallelize independent work, or remove a network hop and verify it with load tests."
  },
  {
    "location": "5.1",
    "severity": "high",
    "issue": "The rollout changes the primary path by percentage without a same-request comparison between the old and new implementations.",
    "fix": "Add side-effect-safe shadow traffic or a dual-run comparison phase with exit criteria before increasing customer traffic."
  },
  {
    "location": "3.3",
    "severity": "medium",
    "issue": "Customer table ownership and writer permissions are deferred even though the service reads and caches legacy profile data.",
    "fix": "Assign the owner, make the service read-only or define an approved ownership decision, and document the customer-table contract."
  },
  {
    "location": "2.3",
    "severity": "high",
    "issue": "Several callers listed in the call graph have no concrete migration, contract-test, owner, or monolith retirement plan.",
    "fix": "Create a caller inventory and migration plan, name the adapter owner, and set a retirement condition for each legacy path."
  },
  {
    "location": "6.3",
    "severity": "medium",
    "issue": "Payment retries use a local attempt ID instead of the provider idempotency mechanism and do not persist the provider request before retrying.",
    "fix": "Send a provider idempotency key, persist a durable retry record, and deduplicate or reconcile uncertain outcomes before another authorization."
  }
]
```
