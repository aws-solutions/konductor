# Update

I went through the exports. The plan mostly holds; the main items are below.

```release-decision
{
 "decision": "no-go",
 "blockers": [
  {
   "tickets": [
    "REL-112"
   ],
   "summary": "Fix is closed on main but the release branch does not contain its commit.",
   "owner": "Mira Sol"
  },
  {
   "tickets": [
    "REL-118"
   ],
   "summary": "Approved cherry-pick is after the deadline and the commit is not on the release branch.",
   "owner": "Jon Bell"
  }
 ],
 "failing_jobs": [
  "linux-integration"
 ],
 "flaky_jobs": [
  "windows-smoke"
 ],
 "late_cherry_picks": [
  "REL-118",
  "REL-145",
  "REL-153"
 ],
 "notes_corrections": [
  "REL-127",
  "REL-145",
  "REL-153"
 ],
 "earliest_release_date": "2027-04-22"
}
```
