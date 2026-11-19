# September steering review: shipping risk

**Bottom line:** I would not treat 2027-09-24 as committed yet. The open Session Bridge chain totals 37 points and runs through MOB-158, due 2027-09-10, four calendar days after the 2027-09-06 code freeze. The freeze date is a Monday public holiday, so the available working window is shorter than the roadmap line suggests. The provider's v1 response endpoint retires on 2027-08-20, before launch. The team needs an owner for MOB-089, a continuity plan for the Session Bridge work, and a steering decision on the untracked diagnostic-export behavior before it can make a credible go/no-go call.

## What needs steering attention

- **Key-person dependency:** MOB-014, MOB-037, MOB-063, MOB-089, MOB-112, MOB-137, and MOB-158 are all Session Bridge work. Every assigned ticket in that component names Priya Nair, and MOB-089 is blank. Owen Wright should pair Priya with Jon Bell, transfer the build and test steps, and review the handoff before the candidate build.
- **Provider compatibility deadline:** MOB-052 updates the relay client for the v2 response envelope. The contract retires v1 on 2027-08-20. Sana Patel should get a passing sandbox and device result from Diego Alvarez before that date, with the old parser retained only as a time-bounded fallback.
- **Unowned chain work:** MOB-089 is open, depends on MOB-063, and is due 2027-08-13 without an assignee. Owen Wright should assign it immediately, confirm the estimate and handoff, and escalate if the owner cannot start before the provider compatibility check.
- **Untracked launch scope:** The 2027-07-20 note adds encrypted diagnostic-bundle export from Settings for failed account restores. MOB-076 is only the existing Settings diagnostics entry point; it is not a ticket for the added export behavior. Lena Brooks should record acceptance criteria and choose whether to create and schedule the work or remove it from the launch promise. There is no defensible trigger date until that decision is made.
- **Freeze and holiday collision:** The dependency chain ends with MOB-158, whose due date is 2027-09-10. The code freeze is 2027-09-06, which is the listed public holiday. Owen Wright should bring an explicit exception or a reduced launch scope to steering before the freeze, rather than assuming the holiday can be recovered later.

MOB-144 is not included: the 2027-08-11 follow-up says its clean-install and upgrade-path entitlement checks passed and the ticket is closed. I would hold the next review on the provider result, the MOB-089 owner and handoff, the Session Bridge continuity check, and the freeze exception decision.

```risks
{
  "risks": [
    {
      "id": "R-KEY-PERSON",
      "tickets": ["MOB-014", "MOB-037", "MOB-063", "MOB-089", "MOB-112", "MOB-137", "MOB-158"],
      "kind": "key-person",
      "likelihood": "high",
      "impact": "high",
      "owner": "Owen Wright",
      "mitigation": "Pair Priya Nair with Jon Bell, transfer the Session Bridge build and test steps, and review the handoff before the candidate build.",
      "trigger_date": "2027-09-06"
    },
    {
      "id": "R-VENDOR-DATE",
      "tickets": ["MOB-052"],
      "kind": "vendor",
      "likelihood": "high",
      "impact": "high",
      "owner": "Sana Patel",
      "mitigation": "Obtain v2 sandbox and device evidence before v1 retirement, while retaining the old parser as a time-bounded fallback.",
      "trigger_date": "2027-08-20"
    },
    {
      "id": "R-UNOWNED-CHAIN",
      "tickets": ["MOB-089"],
      "kind": "unowned",
      "likelihood": "high",
      "impact": "high",
      "owner": "Owen Wright",
      "mitigation": "Assign an engineer immediately, confirm the estimate and dependency handoff, and escalate if work cannot start before the compatibility check.",
      "trigger_date": "2027-08-13"
    },
    {
      "id": "R-SCOPE-ADD",
      "tickets": ["MOB-076"],
      "kind": "scope",
      "likelihood": "medium",
      "impact": "high",
      "owner": "Lena Brooks",
      "mitigation": "Write acceptance criteria for encrypted diagnostic export and decide whether to schedule a new ticket or remove the behavior from the launch promise.",
      "trigger_date": null
    },
    {
      "id": "R-FREEZE-HOLIDAY",
      "tickets": ["MOB-158"],
      "kind": "schedule",
      "likelihood": "high",
      "impact": "high",
      "owner": "Owen Wright",
      "mitigation": "Bring a freeze exception or reduced launch scope to steering before the holiday freeze, with a candidate-build and rollback decision recorded.",
      "trigger_date": "2027-09-06"
    }
  ],
  "top_three": ["R-KEY-PERSON", "R-VENDOR-DATE", "R-UNOWNED-CHAIN"]
}
```
