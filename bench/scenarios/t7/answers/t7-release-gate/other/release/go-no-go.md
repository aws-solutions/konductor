# 27.05 release call

**No-go for Thursday 2027-05-06.** The earliest defensible date is Thursday 2027-05-13 (the 27.06 slot), and only if
the three fixes are on `release/27.05` by the 2027-05-05 17:00 UTC cherry-pick deadline and the branch passes the
2027-05-10 to 2027-05-12 validation window.

## Blockers

| Ticket | Why it blocks | Owner |
| --- | --- | --- |
| REL-131 | `linux-integration` (required) has failed every run since commit c9f1e2a, REL-131's commit: 10 of 20 runs | Asha Nair |
| REL-112 | Closed on main, but a7d4e1c is not on the release branch, and its cherry-pick is still only *proposed* | Mira Sol |
| REL-118 | Approved 2027-04-29 09:15, about 16 hours after the 2027-04-28 17:00 deadline, and not on the branch | Jon Bell |

REL-118 would be on time for the 27.06 deadline, so the late approval stops mattering if we move a week. For this
Thursday it would need an explicit exception, which nobody has granted.

## Other signals

`windows-smoke` is a different problem: intermittent, 17 of 20 green (85%), no first failing commit. It is a risk that
needs an owner and either a clean run or a written exception. It is not the same as the linux failure.
`docs-linkcheck` is optional and had one timeout.

REL-145 carries a release-blocker label, but triage demoted it to the maintenance queue, so it is not a blocker.
REL-153 was cancelled.

## Release notes

The draft must describe what the branch ships:

- REL-127 was reverted. Take the cache-header promise out.
- REL-104 is in Highlights, but its commit is not on the branch (approved, never merged).

REL-112 stays out of Fixes until its pick lands.

## Before the next call

Fresh CI on `release/27.05` after the picks land: `linux-integration` green, `windows-smoke` clean or excepted.
Closed tickets and approvals are not evidence by themselves.

```release-decision
{
  "decision": "no-go",
  "earliest_release_date": "2027-05-13",
  "blockers": [
    {"tickets": ["REL-131"], "owner": "Asha Nair", "summary": "linux-integration fails on every run since c9f1e2a."},
    {"tickets": ["REL-112"], "owner": "Mira Sol", "summary": "a7d4e1c is not on release/27.05; pick still proposed."},
    {"tickets": ["REL-118"], "owner": "Jon Bell", "summary": "Pick approved after the 2027-04-28 17:00 deadline; not on the branch."}
  ],
  "failing_jobs": ["linux-integration"],
  "flaky_jobs": ["windows-smoke", "docs-linkcheck"],
  "late_cherry_picks": ["REL-118"],
  "notes_corrections": ["REL-104", "REL-127"]
}
```
