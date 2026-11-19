# Shared deployment program

## The decision for staff

Leadership can frame this as one program to replace three production deployment paths with one shared deployment tool for Atlas, Beacon, and Cedar. The outcome is consistent registration, approval, promotion, rollback, and deployment history by 2027-08-27. The date is credible only if the Identity Services dependency is staffed and the Atlas/Beacon ownership conflict is settled before the pilot.

The tool choice must meet the highest existing bar, not the most common current setting. Atlas's active ForgeRun path retains audit records for 365 days, while the other active paths retain fewer. The shared option therefore needs at least 365 days of retrievable audit history, OIDC sign-in, and approval history. This is a selection constraint rather than a reason to choose a particular tool before capability and migration estimates are checked.

The staffing ask is 7 dedicated engineers: 2 each from Atlas, Beacon, and Cedar, plus 1 from Identity Services. The sheet shows 4 available program engineers, so the gap is **3 engineers**. The current capacity rows also show reduced days on the listed holidays. We should not treat those rows as committed delivery dates until the missing staffing is resolved.

## Workstreams

- **Tool selection and governance**: define the common deployment contract, compare the three active paths against the audit and identity requirements, and agree on ownership and rollout rules. It depends on `REQ-012` because the shared runner identity and secrets interface must be part of the contract.
- **Identity integration**: make the shared service-account identity and secrets path available to release jobs, with the required approval and audit events. It depends on `REQ-012`, whose owner is Identity Services.
- **Migration and cutover**: build adapters, pilot representative services, then move Atlas, Beacon, and Cedar in controlled waves with rollback checks. It depends on `REQ-012` and on the tool decision. The first cutover should not be scheduled as if the identity interface were optional.

The ticket export calls `REQ-012` “Provide deployment identity for service accounts.” Its comment says release jobs need token exchange through the Identity Services endpoint, and the roadmaps record it as the dependency for each team's Q3 deployment work.

## Ownership issue to take to staff

Atlas and Beacon both list **Shared deployment migration** in 2027-Q3 under their own ownership. The program needs one accountable owner for the shared migration and named delivery owners for each team's cutover. Until staff resolves that split, the Q3 roadmap commitments overlap and should not be treated as two independent commitments.

## First milestones

| Milestone | Date | Evidence needed |
|---|---|---|
| Tool decision | 2027-05-14 | A comparison against 365-day audit retention, OIDC, approvals, rollback, and migration effort. |
| Pilot ready | 2027-06-18 | Identity integration and the common contract work in a testable state. |
| First product cutover | 2027-07-30 | A representative service moved with approval, audit, rollback, and an agreed owner. |
| All in-scope teams on shared tool | 2027-08-27 | Atlas, Beacon, and Cedar production services migrated or an explicitly approved exception recorded. |

## Open questions

- Will Atlas or Beacon own the shared migration, and who approves the decision if both roadmaps retain the work?
- Can Identity Services commit the one engineer and a date for `REQ-012`, including the secrets and token-exchange interface?
- Which services are in the first pilot and first cutover waves, and what is the rollback threshold for each team?
- Do all candidate tools support the required 365-day audit retrieval and approval history without a separate archive?
- What additional engineering capacity can leadership fund or loan to close the three-engineer gap?

## Out of scope

`REQ-068` is the high-vote request to add feature flag controls to the release console. Feature flag controls are explicitly outside this program, along with CI build systems and data migrations.

```program
{
  "problem": "Replace three production deployment paths with one shared deployment tool for Atlas, Beacon, and Cedar, while preserving approvals, rollback, OIDC sign-in, and at least 365 days of retrievable audit history by 2027-08-27.",
  "workstreams": [
    {
      "name": "Tool selection and governance",
      "teams": ["Atlas", "Beacon", "Cedar", "TPM"],
      "depends_on": ["REQ-012"]
    },
    {
      "name": "Identity integration",
      "teams": ["Identity Services", "Atlas", "Beacon", "Cedar"],
      "depends_on": ["REQ-012"]
    },
    {
      "name": "Migration and cutover",
      "teams": ["Atlas", "Beacon", "Cedar"],
      "depends_on": ["REQ-012", "Tool selection and governance"]
    }
  ],
  "shared_dependencies": [
    "Identity Services auth and secrets service (REQ-012)"
  ],
  "conflicts": [
    {
      "between": ["Atlas", "Beacon"],
      "about": "Shared deployment migration in 2027-Q3"
    }
  ],
  "headcount_gap": 3,
  "constraints": [
    "Deployment audit records must be retrievable for at least 365 days.",
    "The shared tool must support OIDC sign-in and approval history.",
    "All three product teams need a usable rollback path before cutover."
  ],
  "milestones": [
    {"name": "Tool decision", "date": "2027-05-14"},
    {"name": "Pilot ready", "date": "2027-06-18"},
    {"name": "First product cutover", "date": "2027-07-30"},
    {"name": "All in-scope teams on shared tool", "date": "2027-08-27"}
  ],
  "open_questions": [
    "Ownership decision: who owns the shared migration between Atlas and Beacon?",
    "Can Identity Services commit capacity and a date for REQ-012?",
    "Which services belong in the pilot and first cutover waves?",
    "Do all candidate tools meet the audit and approval requirements?",
    "How will leadership close the three-engineer staffing gap?"
  ],
  "out_of_scope": ["REQ-068"]
}
```
