# Design review

This design has a useful end-to-end shape, but it is not ready for a production pilot. The highest risks are an unbounded outbound destination, unauthorized data in the standard payload, and authentication choices that allow broad forgery or replay. The delivery isolation and retention choices also contradict the platform's stated operating constraints. Resolve those items before enabling production connections.

## Findings

### 3.2, critical

The registry accepts any syntactically valid HTTPS URL, and the worker resolves it at request time through an egress path with no private-range restriction. A partner-controlled destination can therefore direct the sender toward internal services or metadata endpoints. Validate and revalidate the resolved address, reject private and link-local ranges, and enforce an egress allowlist or equivalent network policy.

### 3.3, high

The signature covers only the body. Since the request has no timestamp, nonce, or replay window, a captured valid request can be submitted again. Include a timestamp in the signed input, reject requests outside a replay window, and use an event or nonce replay record where the partner contract requires it.

### 3.4, high

Every connection uses `WEBHOOK_SIGNING_SECRET`, while the authentication service defines partner-scoped credentials and key versions. A leak from one partner would let an attacker forge requests for every partner, and revocation cannot be limited to the affected connection. Use a per-partner or per-connection key with credential scope and selective revocation.

### 3.5, critical

The payload includes `tenant_id`, customer name, email, and shipping address, but the data policy's standard profile excludes tenant ID and personal-data fields. The service must enforce the approved field set when assembling the payload and remove customer contact and address fields unless a separately approved contract and purpose exists.

### 3.6, medium

A secret change takes effect only after a rolling restart, and old workers cannot select an old or new key by version during an overlap. Use dual-key verification or signing with an explicit key version, keep the old key active for the documented overlap, and rotate without downtime.

### 3.7, high

The single FIFO queue and shared claim pool give a slow partner's retries access to capacity needed by unrelated tenants. That conflicts with the 60-second cross-tenant delay target and can also put enterprise delivery targets at risk. Add per-tenant queueing or fair scheduling with isolated capacity and define what happens when a tenant or partner exceeds its share.

### 3.8, high

The design stores complete payloads in the delivery database and central logs for 365 days. That conflicts with the delivery-log policy's 14-day default, 30-day maximum, and metadata-plus-redacted-digest requirement, while expanding exposure of personal data. Retain metadata only, use a redacted payload digest where support needs correlation, and enforce the 14-day or approved maximum retention in both stores.

The implementation should also make the partner acknowledgement and duplicate-handling contract explicit, define ordering expectations for status changes, and document load-shedding behavior when a vendor is slow. Those details affect the rollout decision even after the blocking risks above are addressed.

```json
[
  {
    "location": "3.2",
    "severity": "critical",
    "issue": "Arbitrary HTTPS destinations can resolve to private or infrastructure addresses, allowing a partner URL to reach internal services.",
    "fix": "Reject private address ranges after DNS resolution and enforce an egress allowlist."
  },
  {
    "location": "3.3",
    "severity": "high",
    "issue": "Body-only signatures have no freshness check, so captured requests can be replayed.",
    "fix": "Sign a timestamp and enforce a replay window, with a nonce where needed."
  },
  {
    "location": "3.4",
    "severity": "high",
    "issue": "One signing secret is shared across every connection, making compromise and revocation global.",
    "fix": "Use per-partner keys with credential scope and selective revocation."
  },
  {
    "location": "3.5",
    "severity": "critical",
    "issue": "The payload contains personal-data fields excluded by the approved standard profile and data policy.",
    "fix": "Enforce the approved field set and remove customer fields unless a separately approved purpose exists."
  },
  {
    "location": "3.6",
    "severity": "medium",
    "issue": "Secret rotation requires a worker restart and has no old/new key overlap.",
    "fix": "Support dual-key overlap and versioned keys so rotation occurs without downtime."
  },
  {
    "location": "3.7",
    "severity": "high",
    "issue": "A shared FIFO retry queue lets one slow partner consume capacity needed by other tenants.",
    "fix": "Use per-tenant queues or fair scheduling with isolated capacity."
  },
  {
    "location": "3.8",
    "severity": "high",
    "issue": "Full payloads are retained in delivery records and logs for 365 days, contrary to the retention policy.",
    "fix": "Keep metadata only or a redacted payload digest and enforce 14-day retention, never exceeding 30 days."
  }
]
```
