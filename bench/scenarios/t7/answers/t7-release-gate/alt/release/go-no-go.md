# Answer

The figures below come from the files in this folder; the reasoning follows the data block.

```release-decision
{
 "earliest_release_date": "2027-05-13",
 "notes_corrections": [
  "REL-104",
  "REL-127",
  "REL-112"
 ],
 "late_cherry_picks": [
  "REL-118"
 ],
 "flaky_jobs": [
  "windows-smoke"
 ],
 "failing_jobs": [
  "linux-integration"
 ],
 "blockers": [
  {
   "owner": "Asha Nair",
   "summary": "In short: Required linux-integration has repeated failures beginning at this issue's main commit.",
   "tickets": [
    "REL-131"
   ]
  },
  {
   "owner": "Jon Bell",
   "summary": "In short: Approved cherry-pick is after the deadline and the commit is not on the release branch.",
   "tickets": [
    "REL-118"
   ]
  },
  {
   "owner": "Mira Sol",
   "summary": "In short: Fix is closed on main but the release branch does not contain its commit.",
   "tickets": [
    "REL-112"
   ]
  }
 ],
 "decision": "no-go"
}
```

## Reasoning

The open REL-145 row is excluded from this blocker list because the triage record demotes it to the normal maintenance queue. That label alone is not enough to make it a release blocker.
- For the next slot, the calendar gives a 2027-05-05 17:00 cherry-pick deadline and a 2027-05-10 through 2027-05-12 validation window. If the owners cannot provide branch and CI evidence by those points, move to the following slot rather than treating a stale approval as a go signal.
- Recheck the complete required-job set after the branch contains the intended fixes. `api-contract` is clean in the seven-day summary; the two failing signals still need fresh evidence.
- Remove or rewrite the **REL-127** release-note promise. The issue is marked Reverted, so the draft must not claim that the cache-header behavior ships.
`windows-smoke` is also a required release signal with an 85% seven-day pass rate and intermittent failures. It must be made clean or have an explicitly accepted exception before the release is reconsidered. The consistently failing `linux-integration` signal and the intermittent Windows signal should not be combined into one risk because they need different evidence and owners.
- **REL-131, owner Asha Nair:** `linux-integration` has repeated failures beginning at commit `c9f1e2a`, which is this issue's main commit. Fix or revert the regression and show a clean required-job run.
- **REL-118, owner Jon Bell:** Its approved `b4e2f90` cherry-pick was approved at 2027-04-29 09:15, after the 2027-04-28 17:00 deadline, and is not on the release branch. Reconfirm the exception with the release owner, get it onto the branch, and rerun validation. This is the only late approved cherry-pick in the queue.
- **REL-112, owner Mira Sol:** The issue is closed on main, but its `a7d4e1c` fix is not present on `release/27.05`. Verify the cherry-pick and rerun the relevant upgrade checks.
**Bottom line: no-go for Thursday, 2027-05-06.** The current evidence does not support shipping the release branch. The earliest scheduled slot is Thursday, 2027-05-13, provided the fixes below land before that slot's deadlines and the validation window is clean.
