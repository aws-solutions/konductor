# Architecture review: event-sourced orders

This proposal has a sensible persistence direction and a credible migration shape, but it is not ready for implementation approval. The public product behavior, recovery objective, privacy contract, and reporting contract are stronger than the design's asynchronous and immutable-storage assumptions. The missing event evolution policy also turns a short-term schema decision into a long-lived operational liability.

The most urgent issue is recovery. The stated replay rate does not support the claimed recovery estimate at the event volume in the packet, even before projected growth. The team needs a recovery design that can restore service inside the 15-minute RTO without relying on an unbounded full replay. Customer visibility has a similarly direct contract mismatch: returning an old projection after a successful write is explicitly different from the product's read-your-write behavior.

The privacy design needs a source-of-truth deletion strategy, such as minimizing personal data in events and using a reversible reference or cryptographic erasure scheme where appropriate. Indefinite retention of plaintext address and customer identifiers cannot coexist with deletion that only removes derived rows. The reporting decision should be revisited against the existing outbox and audit tables before accepting the cost of a new stream and projection contract.

The event contract needs an explicit evolution policy before the first production event is written. A field-default rule does not cover renamed fields, changed meanings, removed fields, new invariants, or aggregate logic that must interpret old facts. Define event versions, compatibility rules, upcasters, and tests for representative historical streams.

The snapshot paragraph is directionally useful but leaves the operational design unresolved. Specify the creation trigger, transaction and concurrency behavior, format migration, indexes, storage limits, corruption handling, and metrics. Also validate the migration converter: the existing audit rows do not necessarily contain enough old values to reconstruct every historical transition, so parity criteria must distinguish an exact history from a current-state backfill.

Before approval, the design should also pin down ordering and duplicate behavior across the relay and fulfillment boundary, the effect of partitioning on per-order stream reads, and the load-shedding behavior when a projection or broker is unavailable. The proposal's access-control direction is good, but event payload minimization and deletion should be tested against backups, exports, logs, and derived stores rather than only live projections.

```json
[
  {
    "location": "3.2",
    "severity": "high",
    "issue": "Immutable events are retained for the service lifetime, but optional fields and tolerant consumers are the only evolution mechanism. That does not define how renamed fields, changed meanings, removed fields, or new aggregate rules will interpret years of stored events.",
    "fix": "Define event versioning and upcasters, with compatibility rules and historical-stream tests before production events are written."
  },
  {
    "location": "3.3",
    "severity": "critical",
    "issue": "Customer reads come from an asynchronous projection and the fallback explicitly returns the last available row when it is behind. That violates the product requirement for immediate visibility after a successful place request and can show a customer that the new order does not exist.",
    "fix": "Add read-your-writes handling, such as a consistent read from the event store or a projection catch-up token that the read path honors before returning."
  },
  {
    "location": "6.2",
    "severity": "critical",
    "issue": "The packet has 174.66 million current events, while the stated replay benchmark is 2.5 million events per minute. That is roughly 70 minutes of replay, not the claimed ten, so a full rebuild misses the 15-minute RTO and grows farther from it at the projected volume.",
    "fix": "Recalculate the estimate with measured replay throughput and define an RTO-capable recovery plan using snapshots, incremental rebuilds, or another bounded path."
  },
  {
    "location": "7.2",
    "severity": "critical",
    "issue": "The event payload contains customer identifiers, addresses, and possibly contact details, and the log is retained indefinitely. Deleting only projection rows leaves personal data in the immutable source and cannot satisfy the deletion contract.",
    "fix": "Minimize personal data in events and define redaction or tokenization plus a retention policy that covers the event log, backups, exports, and derived stores."
  },
  {
    "location": "5.1",
    "severity": "medium",
    "issue": "The comparison reduces the current CRUD model to current state only even though the current system already has a relay-backed outbox and an audit table. It omits the simpler outbox plus audit-table option, so the decision does not compare the proposed operational cost with the existing capabilities.",
    "fix": "Add the outbox and audit table as a simpler option and compare its history, integration, migration, and operating costs with event sourcing."
  },
  {
    "location": "4.1",
    "severity": "medium",
    "issue": "Snapshots are mentioned as a solution for long streams, but the design defers the interval and does not define the trigger, storage and index layout, format migration, concurrency, or retention operations. This leaves both command latency and recovery dependent on an unbuilt mechanism.",
    "fix": "Specify the snapshot trigger, snapshot storage, format and retention policy, atomicity with stream versions, and repair metrics in the design spike."
  },
  {
    "location": "5.2",
    "severity": "high",
    "issue": "The reporting contract requires direct SQL, current-day questions, seven-year reproducibility, and complete agent activity, while the proposal removes SQL and only gestures at an API, daily export, or future feed. The existing two-day export also lacks the full audit payload, so reporting loses required capability at cutover.",
    "fix": "Design a reporting projection with a schema contract and a timely warehouse feed, preserving actor history and seven-year reproducibility before removing SQL access."
  }
]
```