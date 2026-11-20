# Outbound webhook requirements

## Requirements: notes

* **R1 — Event coverage:** The first release shall support `payment.authorized`, `payment.failed`, `refund.created`, and `payout.completed`. It shall reject subscriptions to event names outside this catalog and make the catalog discoverable through the customer-facing API.
* **R2 — Subscriptions:** An account administrator shall be able to create, inspect, update, disable, and delete an endpoint subscription. A subscription shall select one or more supported event types and shall not affect another account's events.
* **R3 — Envelope:** Each delivery shall contain an immutable public event identifier, event type, account identifier, occurrence timestamp, schema version, and payload. Timestamps shall be RFC 3339 values with an explicit offset, and the request shall carry a delivery identifier for operational correlation.
* **R4 — Capacity:** The service shall support a sustained peak of **2,400 events per minute per account** and bursts up to **4,000 events per minute per account** without dropping committed events. Capacity tests shall cover the account-level rate and the aggregate worker queue.
* **R5 — Delivery and deduplication:** Delivery shall be **at-least-once**. The same committed event shall retain a **stable event identifier for 30 days**, including across retries, so a consumer can deduplicate it. A retry shall never create a new public event identifier.
* **R6 — Retry window:** A delivery that does not receive an accepted response shall use **exponential backoff**, retry for **48 hours**, and then stop further attempts for that delivery. The final failure and its reason shall be visible to the account administrator and to operations.
* **R7 — Ordering:** The service shall preserve ordering **per account and endpoint** for events in the same stream. It shall make **no ordering promise across streams**; consumers shall use the event identifier and occurrence timestamp rather than assume a global sequence.
* **R8 — Request signing:** Every delivery request shall include an **HMAC-SHA256** signature over the defined request representation, with replay protection and the event identifier available to the verifier. After rotation, the **previous signing key** shall remain valid during a **7-day overlap**; the active and previous key states shall not be written to logs.
* **R9 — Endpoint verification:** An endpoint shall use **HTTPS** with certificate validation and shall complete a **signed challenge before activation**. The service shall reject activation until the expected challenge token is returned, and it shall re-verify an endpoint when its ownership or URL changes.
* **R10 — Regional processing:** For a customer contracted to the EU cell, the endpoint shall be **hosted in the EU** before activation and the webhook service shall **not transfer those payloads outside the EU**. The API shall show the selected processing cell and reject a location that violates the customer's contract.
* **R11 — Payment-data handling:** A webhook payload and its normal logs **must not include a full payment card number or card security code**. Bearer tokens, credentials, and other secrets shall also be excluded. The payload shall use the existing opaque identifiers and shall document any field that is redacted.
* **R12 — Existing service objectives:** The webhook dispatch path shall retain the platform target of **99.9% monthly availability**. A committed event shall be accepted by the event outbox within **60 seconds at the 99th percentile**, and dispatch health, queue lag, remote response class, and endpoint status shall be observable separately.
* **R13 — Failure isolation:** A slow or failing endpoint shall not block a payment write, another account, or an unrelated endpoint. Operators shall be able to pause one endpoint without pausing the internal event publisher and shall be able to resume it without losing committed events.
* **R14 — Lifecycle and API behavior:** The API shall return an actionable problem response for invalid event types, invalid endpoint locations, failed verification, and unauthorized subscription changes. Disabling an endpoint shall preserve delivery history and audit records while preventing new attempts.

## Scope and context: notes

Ledgerline Payments will add outbound HTTPS webhooks for the event stream already produced by the outbox. Webhook delivery is asynchronous to payment writes. The requirements below are intended to constrain an implementation while leaving queue and storage choices open.

## Assumptions and open points: notes

* Assume the outbox remains the source of truth for committed events and that its event record can supply the immutable public event identifier.
* Assume customers own the receiving service and can expose the signed verification challenge over HTTPS.
* The payload schema versioning and sunset policy remain open points for the API design.
* The exact accepted-response status range and the dashboard retention period remain open points; they must be resolved before implementation is approved.
* The initial design should treat the regional processing contract as authoritative when customer settings and endpoint metadata disagree.

```json
{
    "assumptions": [
        "The outbox remains the source of truth for committed events.",
        "Customers can expose a signed HTTPS verification challenge.",
        "Payload versioning, accepted response statuses, and dashboard retention remain open points."
    ],
    "requirements": [
        {
            "text": "The first release shall support payment.authorized, payment.failed, refund.created, and payout.completed, and reject event names outside this catalog.",
            "id": "R1"
        },
        {
            "text": "Account administrators can manage endpoint subscriptions and select supported event types without affecting another account.",
            "id": "R2"
        },
        {
            "text": "Each delivery includes an immutable event identifier, event type, account identifier, RFC 3339 occurrence timestamp, schema version, and delivery identifier.",
            "id": "R3"
        },
        {
            "text": "Support 2,400 events per minute per account sustained and bursts up to 4,000 events per minute per account without dropping committed events.",
            "id": "R4"
        },
        {
            "text": "Delivery is at-least-once; the same event has a stable event identifier for 30 days across retries.",
            "id": "R5"
        },
        {
            "text": "Use exponential backoff for 48 hours, then stop further attempts and expose the final failure.",
            "id": "R6"
        },
        {
            "text": "Preserve ordering per account and endpoint within a stream, with no ordering promise across streams.",
            "id": "R7"
        },
        {
            "text": "Sign every request with HMAC-SHA256 and keep the previous signing key valid for a 7-day overlap after rotation.",
            "id": "R8"
        },
        {
            "text": "Require HTTPS and a signed challenge before endpoint activation, rejecting activation until the expected token returns.",
            "id": "R9"
        },
        {
            "text": "Keep EU customer webhook payloads with an endpoint hosted in the EU and do not transfer them outside the EU.",
            "id": "R10"
        },
        {
            "text": "Webhook payloads and normal logs must not include a full payment card number or card security code.",
            "id": "R11"
        },
        {
            "text": "Retain 99.9% monthly availability and accept a committed event into the outbox within 60 seconds at the 99th percentile.",
            "id": "R12"
        },
        {
            "text": "Isolate failing endpoints so they cannot block payment writes, other accounts, or unrelated endpoints.",
            "id": "R13"
        },
        {
            "text": "Provide lifecycle operations for verification, disabling, audit history, and actionable API errors.",
            "id": "R14"
        }
    ]
}
```
