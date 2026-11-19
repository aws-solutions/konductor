# Design review

The design has a sensible request state model, bounded queue work, idempotency records, and a useful operational export. I would not approve the rollout as written. The proposal treats live-system success as deletion completion even though the inventory includes additional retained copies and an external recipient system. It also uses the wrong statutory clock and stores more identifying data in its evidence record than the stated policy requires.

The highest risks are a missed legal deadline, an inaccurate completion claim, and residual personal data in systems that the user cannot see. The implementation needs an explicit system-by-system completion contract, an owner and result for every retained copy, and a response path for failures rather than relying on a queue acknowledgement or a daily review.

## Findings

- **2.2, critical:** The due date is based on 30 business days and pauses for holidays, but the legal brief requires 30 calendar days from verification. A request can therefore exceed the statutory deadline. Use a UTC calendar-day calculation with legal holds as an explicit, separately recorded exception; do not exclude weekends or holidays.
- **3.2, high:** The worker leaves 90-day database snapshots and object manifests untouched while declaring the request complete. Recovery copies can preserve the account after live deletion. Define how backup retention and restore filtering satisfy erasure, or document a lawful exception and report it to Privacy Operations before completion.
- **3.3, high:** The design only publishes the existing account event and never sends a warehouse deletion action. The inventory identifies account-level rows in the analytics warehouse, so those rows can remain for 24 months. Emit a `data-control-events` deletion command, have Data Platform acknowledge and reconcile it, and include its result in completion.
- **3.4, high:** The Notification vendor keeps recipient and delivery metadata, but the worker deliberately avoids the vendor API. The design therefore does not fulfill deletion for an external copy. Have Notification call the provider removal endpoint, record its result and retry state, and expose a vendor failure as an exception rather than silently completing.
- **4.1, medium:** Queue acknowledgement is being used as the completion signal, while the design has no end-to-end check that each action returned a durable result and no complete report for missing downstream work. A worker can acknowledge incomplete work or a later consumer can fail without changing the request state. Make completion depend on all required action results and publish a report that Privacy Operations can reconcile.
- **5.2, medium:** The evidence record keeps the email address and display name for convenience even though the stated requirement says a request reference and account identifier are sufficient. This increases the personal-data footprint and the impact of an evidence-store disclosure. Remove those fields and use the request reference or a controlled support lookup when identity must be confirmed.

```json
[
  {
    "location": "2.2",
    "severity": "critical",
    "issue": "The deadline uses 30 business days and excludes holidays instead of the required 30 calendar days from verification, so requests can become late.",
    "fix": "Calculate due_at as 30 calendar days from verified_at in UTC, and record legal holds as explicit exceptions rather than pausing the ordinary clock."
  },
  {
    "location": "3.2",
    "severity": "high",
    "issue": "The design declares completion while 90-day snapshots and object manifests can still contain account data.",
    "fix": "Define backup retention and restore filtering for erasure, then report any retained recovery copy as a documented exception before completion."
  },
  {
    "location": "3.3",
    "severity": "high",
    "issue": "The analytics warehouse is listed as an account-level copy but receives no deletion action or completion result.",
    "fix": "Send a deletion command on data-control-events, reconcile the warehouse result, and include that result in the request's completion gate."
  },
  {
    "location": "3.4",
    "severity": "high",
    "issue": "The external notification provider is not told to remove its recipient and delivery metadata.",
    "fix": "Have Notification invoke the provider removal endpoint, persist its retry result, and surface an unresolved vendor failure."
  },
  {
    "location": "4.1",
    "severity": "medium",
    "issue": "A queue acknowledgement can make the request look complete without an end-to-end check or a reliable report of every required action.",
    "fix": "Gate completion on durable results from every required system and produce a reconciliable completion report for Privacy Operations."
  },
  {
    "location": "5.2",
    "severity": "medium",
    "issue": "The evidence record retains email and display name even though a request reference and account ID meet the stated evidence need.",
    "fix": "Remove email and name from the audit record and use a controlled request-reference lookup for support identity checks."
  }
]
```