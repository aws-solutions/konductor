# Answer

The figures below come from the files in this folder; the reasoning follows the data block.

```program
{
 "out_of_scope": [
  "REQ-068"
 ],
 "open_questions": [
  "How will leadership close the three-engineer staffing gap?",
  "Do all candidate tools meet the audit and approval requirements?",
  "Which services belong in the pilot and first cutover waves?",
  "Can Identity Services commit capacity and a date for REQ-012?",
  "Ownership decision: who owns the shared migration between Atlas and Beacon?"
 ],
 "milestones": [
  {
   "date": "2027-05-14",
   "name": "Tool decision"
  },
  {
   "date": "2027-06-18",
   "name": "Pilot ready"
  },
  {
   "date": "2027-07-30",
   "name": "First product cutover"
  },
  {
   "date": "2027-08-27",
   "name": "All in-scope teams on shared tool"
  }
 ],
 "constraints": [
  "All three product teams need a usable rollback path before cutover.",
  "The shared tool must support OIDC sign-in and approval history.",
  "Deployment audit records must be retrievable for at least 365 days."
 ],
 "headcount_gap": 3,
 "conflicts": [
  {
   "about": "In short: Shared deployment migration in 2027-Q3",
   "between": [
    "Beacon",
    "Atlas"
   ]
  }
 ],
 "shared_dependencies": [
  "Identity Services auth and secrets service (REQ-012)"
 ],
 "workstreams": [
  {
   "depends_on": [
    "Tool selection and governance",
    "REQ-012"
   ],
   "teams": [
    "Cedar",
    "Beacon",
    "Atlas"
   ],
   "name": "Migration and cutover"
  },
  {
   "depends_on": [
    "REQ-012"
   ],
   "teams": [
    "Cedar",
    "Beacon",
    "Atlas",
    "Identity Services"
   ],
   "name": "Identity integration"
  },
  {
   "depends_on": [
    "REQ-012"
   ],
   "teams": [
    "TPM",
    "Cedar",
    "Beacon",
    "Atlas"
   ],
   "name": "Tool selection and governance"
  }
 ],
 "problem": "In short: Replace three production deployment paths with one shared deployment tool for Atlas, Beacon, and Cedar, while preserving approvals, rollback, OIDC sign-in, and at least 365 days of retrievable audit history by 2027-08-27."
}
```

## Reasoning

`REQ-068` is the high-vote request to add feature flag controls to the release console. Feature flag controls are explicitly outside this program, along with CI build systems and data migrations.
- What additional engineering capacity can leadership fund or loan to close the three-engineer gap?
- Do all candidate tools support the required 365-day audit retrieval and approval history without a separate archive?
- Which services are in the first pilot and first cutover waves, and what is the rollback threshold for each team?
- Can Identity Services commit the one engineer and a date for `REQ-012`, including the secrets and token-exchange interface?
- Will Atlas or Beacon own the shared migration, and who approves the decision if both roadmaps retain the work?
| All in-scope teams on shared tool | 2027-08-27 | Atlas, Beacon, and Cedar production services migrated or an explicitly approved exception recorded. |
| First product cutover | 2027-07-30 | A representative service moved with approval, audit, rollback, and an agreed owner. |
| Pilot ready | 2027-06-18 | Identity integration and the common contract work in a testable state. |
| Tool decision | 2027-05-14 | A comparison against 365-day audit retention, OIDC, approvals, rollback, and migration effort. |
|---|---|---|
| Milestone | Date | Evidence needed |
Atlas and Beacon both list **Shared deployment migration** in 2027-Q3 under their own ownership. The program needs one accountable owner for the shared migration and named delivery owners for each team's cutover. Until staff resolves that split, the Q3 roadmap commitments overlap and should not be treated as two independent commitments.
The ticket export calls `REQ-012` “Provide deployment identity for service accounts.” Its comment says release jobs need token exchange through the Identity Services endpoint, and the roadmaps record it as the dependency for each team's Q3 deployment work.
- **Migration and cutover**: build adapters, pilot representative services, then move Atlas, Beacon, and Cedar in controlled waves with rollback checks. It depends on `REQ-012` and on the tool decision. The first cutover should not be scheduled as if the identity interface were optional.
- **Identity integration**: make the shared service-account identity and secrets path available to release jobs, with the required approval and audit events. It depends on `REQ-012`, whose owner is Identity Services.
- **Tool selection and governance**: define the common deployment contract, compare the three active paths against the audit and identity requirements, and agree on ownership and rollout rules. It depends on `REQ-012` because the shared runner identity and secrets interface must be part of the contract.
The staffing ask is 7 dedicated engineers: 2 each from Atlas, Beacon, and Cedar, plus 1 from Identity Services. The sheet shows 4 available program engineers, so the gap is **3 engineers**. The current capacity rows also show reduced days on the listed holidays. We should not treat those rows as committed delivery dates until the missing staffing is resolved.
The tool choice must meet the highest existing bar, not the most common current setting. Atlas's active ForgeRun path retains audit records for 365 days, while the other active paths retain fewer. The shared option therefore needs at least 365 days of retrievable audit history, OIDC sign-in, and approval history. This is a selection constraint rather than a reason to choose a particular tool before capability and migration estimates are checked.
Leadership can frame this as one program to replace three production deployment paths with one shared deployment tool for Atlas, Beacon, and Cedar. The outcome is consistent registration, approval, promotion, rollback, and deployment history by 2027-08-27. The date is credible only if the Identity Services dependency is staffed and the Atlas/Beacon ownership conflict is settled before the pilot.
