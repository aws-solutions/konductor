# Update

I went through the exports. The plan mostly holds; the main items are below.

```program
{
 "problem": "Replace three production deployment paths with one shared deployment tool for Atlas, Beacon, and Cedar, while preserving approvals, rollback, OIDC sign-in, and at least 365 days of retrievable audit history by 2027-08-27.",
 "workstreams": [
  {
   "name": "Tool selection and governance",
   "teams": [
    "Atlas",
    "Beacon"
   ],
   "depends_on": [
    "REQ-012"
   ]
  },
  {
   "name": "Identity integration",
   "teams": [
    "Identity Services",
    "Atlas"
   ],
   "depends_on": [
    "REQ-012"
   ]
  }
 ],
 "shared_dependencies": [
  "Identity Services auth and secrets service (REQ-012)"
 ],
 "conflicts": [
  {
   "between": [
    "Atlas"
   ],
   "about": "Shared deployment migration in 2027-Q3"
  }
 ],
 "headcount_gap": 2,
 "constraints": [
  "Deployment audit records must be retrievable for at least 365 days.",
  "The shared tool must support OIDC sign-in and approval history."
 ],
 "milestones": [
  {
   "name": "Tool decision",
   "date": "2027-04-23"
  },
  {
   "name": "Pilot ready",
   "date": "2027-05-28"
  }
 ],
 "open_questions": [
  "Ownership decision: who owns the shared migration between Atlas and Beacon?",
  "Can Identity Services commit capacity and a date for REQ-012?",
  "Which services belong in the pilot and first cutover waves?"
 ],
 "out_of_scope": [
  "REQ-068"
 ]
}
```
