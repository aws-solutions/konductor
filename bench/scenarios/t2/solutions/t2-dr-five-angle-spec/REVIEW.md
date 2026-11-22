# Design review: workspace invitations

The design is coherent enough to prototype, but it is not ready for an unrestricted rollout. The main risks are bearer-link lifetime, unbounded list work, and an export contract that conflicts with the archive rules. The email path also needs an operational signal before it can meet the stated on-call standard. The client and notification choices have smaller but real cost and usability consequences.

## Findings

### 3.2 — Reusable bearer links

**Severity: high.** The link has no server-enforced expiry and remains usable after acceptance. The access standard requires a 48-hour expiry and single-use consumption; without both controls, a copied link can grant workspace access again long after the invitation was issued. Add an expiry column and reject expired rows, atomically consume the token on the first successful acceptance, and keep an explicit revoke path for pending rows.

### 3.3 — Unbounded pending-invite response

**Severity: high.** The list endpoint returns every pending row in one response and defers pagination to a future bulk-invite project. The traffic file shows a projected p95 workspace with 260 pending rows, 4.8 million monthly list reads, and continued growth, while the service target is 300 ms. Return cursor pagination with a bounded page size, define the ordering and next cursor, and make the client fetch additional pages.

### 3.4 — No actionable worker alert

**Severity: medium.** A dashboard panel does not satisfy the on-call standard. The standard requires an alert for queue age above five minutes or terminal failures above one percent, plus a runbook for first checks, safe retry, and customer updates. Add those alert rules, link the runbook from each alert, and exercise them with the provider-timeout verification case.

### 3.5 — Three messages per invitation

**Severity: medium.** The design sends three transactional emails for every invitation and treats the fact that the current estimate is below the $5,000 cap as sufficient justification. That is three times the provider volume for one access decision and leaves less capacity for growth and other transactional traffic. Send the recipient message immediately, deduplicate the inviter confirmation where appropriate, and combine administrator notices into a digest or otherwise document an explicit need for each extra email.

### 3.6 — Validation is not conveyed to every user

**Severity: medium.** The specified red and green borders and inline icon do not provide the required text error or a programmatic association with the email control. A user who cannot distinguish colour, or who uses a screen reader, may not know what to fix. Render a text error, connect it to the field with an `aria-describedby` relationship, preserve the label, and announce the asynchronous response without moving focus unexpectedly.

### 3.7 — Removed-member invitations remain in exports

**Severity: high.** The design explicitly keeps invitation rows after a member is removed, but the archive rules say subsequent exports must omit invitations belonging to a removed member. This can expose stale recipient data after the membership transaction has revoked it. Make the export query exclude removed members and their pending invitations, and add a versioned export test that checks the result after removal while retaining only the permitted masked audit history.

The review should block rollout until the security, export, list-bound, and worker changes are agreed. The message and form changes can be delivered in the same implementation pass because they affect the notification and client contracts rather than the migration shape.

```json
[
  {
    "location": "3.2",
    "severity": "high",
    "issue": "The acceptance link has no server-enforced expiry and remains usable after acceptance, so a copied bearer link can grant workspace access again long after the invitation was issued.",
    "fix": "Add a 48-hour expiry, enforce single-use token consumption in the acceptance transaction, and retain an administrator revoke path."
  },
  {
    "location": "3.3",
    "severity": "high",
    "issue": "The pending-invite endpoint returns every row without pagination, which can exceed the 300 ms list target as the documented pending counts and read volume grow.",
    "fix": "Add cursor pagination with a bounded page size and update the client to request the next page."
  },
  {
    "location": "3.4",
    "severity": "medium",
    "issue": "The worker design adds dashboard panels but no alert and runbook for queue age or terminal failures, leaving on-call without the required signal when invitation email stops progressing.",
    "fix": "Add queue-age and terminal-failure alerts, link a runbook, and test the alert with a provider-timeout simulation."
  },
  {
    "location": "3.5",
    "severity": "medium",
    "issue": "Every invitation fans out to three transactional emails even though the design's own figures stay under the cap, consuming three times the provider volume and leaving less headroom for growth and other email traffic.",
    "fix": "Send one email to the recipient, deduplicate inviter confirmations, and use an administrator digest for notices."
  },
  {
    "location": "3.6",
    "severity": "medium",
    "issue": "The form communicates validation state through red and green styling without specifying a text error associated with the field, so colour-blind and screen-reader users may not learn what to correct.",
    "fix": "Add a text error, associate it with the labelled field using aria-describedby, and announce the asynchronous response."
  },
  {
    "location": "3.7",
    "severity": "high",
    "issue": "The export deliberately retains invitation rows for a removed member, contradicting the archive rule that later exports omit those invitations and exposing data that the retention contract says to remove.",
    "fix": "Exclude removed members' invitations from the export query and test the export after removal while retaining only permitted masked audit history."
  }
]
```
