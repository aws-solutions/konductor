# Candidate descriptions

The review compares three deployment shapes. The IDs below are stable labels for the decision record and the price sheet.

| ID | Shape | Operational summary |
| --- | --- | --- |
| `cdn-committed` | CDN with a committed 150 TB monthly plan | Cache public clips at edge locations, pay the plan for the first 150 TB, and pay the listed overage rate for the remainder. |
| `cdn-payg` | CDN with usage-based egress | Use the CDN's usage tiers with no volume commitment. It has less billing commitment but less performance headroom in the measured test. |
| `object-direct` | Direct object-store delivery | Send viewer responses from the origin and apply the object-store tier schedule. It has the fewest moving parts. |

All candidates use the same immutable clip format and origin copy. The decision is about the viewer delivery path, not about changing the media encoding pipeline.
