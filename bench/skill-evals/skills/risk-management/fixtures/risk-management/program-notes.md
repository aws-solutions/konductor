# Data center exit program: kickoff notes

- 14 services must leave the Ashburn colo by 2027-03-31 (lease ends, no extension).
- Teams: Platform (Priya, TPM owner), Payments (Marco), Search (Lin).
- The identity vendor's SAML fix is needed before Payments can cut over. Vendor said
  "mid-January", but they slipped twice last year.
- We are assuming the legacy batch API stays up until the last cutover.
- We are assuming 2 contractors start 2027-01-06. Paperwork is not signed yet.
- The performance test environment was supposed to be ready last week. It is not, and
  Search's load test is blocked as of today.
- Payments depends on the Platform team's new network egress proxy (target 2027-02-01).
- Nobody has checked whether the Search index rebuild fits in the 4-hour cutover window.
