# Review and stabilisation rules

This document is current as of 2027-02-01.

- The release calendar is authoritative for train versions, branch dates, and customer release dates. A train branches six weeks before its listed release date.
- A ticket is considered open for planning when its status is `Open`, `In Progress`, `Ready`, or `Blocked`. `Done`, `Closed`, `Cancelled`, `Duplicate`, and a blank status are not open.
- Estimate cells contain whole story points. A blank estimate is not zero. For an open blank estimate, use the median of the non-blank estimates in the same workstream and round a half point up.
- A dependency named in `depends_on` must be complete before the ticket that names it can be accepted. Ticket IDs in that field are comma-separated.
- Code for a feature must be merged to `main` no later than the branch date to enter that train. Work merged after branch waits for a later train.
- A newly introduced customer feature stays behind its feature flag for one complete train. It may be enabled by default only in the following train after review and stabilisation checks pass.
- The forecast starts with the first sprint beginning after the as-of date. The sprint calendar records dates and company holidays; throughput history is the source for completed story points per ordinary sprint.

The remaining-work export is a snapshot, not a commitment ledger. Its comments may be stale.
