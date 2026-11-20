# Answer

The figures below come from the files in this folder; the reasoning follows the data block.

```status
{
 "scope_added_after_lock_points": 10,
 "capacity_by_sprint": {
  "S30": 23.8,
  "S29": 23.68,
  "S28": 23.58,
  "S27": 23.8
 },
 "reasoning": {
  "sprints_needed": 2.5,
  "team_velocity_points_per_sprint": 18,
  "remaining_points_on_critical_path": 24
 },
 "revised_launch_date": "2027-07-25",
 "critical_path": [
  "PLT-014",
  "PAY-021",
  "CHK-017",
  "CHK-026"
 ],
 "risks": [
  {
   "owner": "Launch product lead",
   "summary": "In short: Three launch-epic tickets created after the 2027-05-28 lock add 10 points.",
   "kind": "scope-creep",
   "tickets": [
    "RISK-023",
    "CHK-037",
    "PAY-034"
   ]
  },
  {
   "owner": "Jon Bell",
   "summary": "In short: Jon Bell has 13 assigned open points in S28 against 0.9 holiday-adjusted capacity.",
   "kind": "over-allocation",
   "tickets": [
    "PAY-031"
   ]
  },
  {
   "owner": "Payments",
   "summary": "In short: PAY-028 is due before its PAY-021 prerequisite, so the recorded dates cannot both be met as written.",
   "kind": "date-conflict",
   "tickets": [
    "PAY-021",
    "PAY-028"
   ]
  },
  {
   "owner": "Platform launch owner",
   "summary": "In short: The 24-point open dependency chain starts with the unassigned certificate prerequisite in another epic and controls launch readiness.",
   "kind": "critical-path",
   "tickets": [
    "CHK-026",
    "CHK-017",
    "PAY-021",
    "PLT-014"
   ]
  }
 ],
 "overall": "red"
}
```

## Reasoning

The blocked CHK-040 item is not included as a launch risk because its CHK-041 prerequisite is already done. The export also contains ordinary closed, cancelled, blank-estimate, and reopened records; blank estimates are not included in point totals.
- **Scope:** PAY-034, CHK-037, and RISK-023 were created after the 2027-05-28 scope lock and add 10 points. Defer them or explicitly accept the later forecast.
- **Capacity:** Jon Bell has 13 open points assigned in S28 on PAY-031, against 0.9 adjusted capacity after the 2027-06-23 holiday. Move that work or provide an explicit staffing change before S28 begins. The adjusted total S28 capacity is 23.58 normalized planning points, compared with the roadmap velocity of 18 delivered points per sprint.
- **Date conflict:** PAY-028 is due 2027-06-26 even though its PAY-021 prerequisite is due 2027-06-28. Replan the dates or confirm which recorded date is stale.
- **Critical dependency:** Assign an owner to **PLT-014** and confirm the vendor certificate handoff. The dependency then runs through PAY-021, CHK-017, and CHK-026 in that order. Filtering only to the launch epic would omit the first prerequisite.
**Overall: red.** The planned 2027-06-25 launch is no longer reachable. The dependency chain that controls readiness has 24 open points and starts with an unassigned certificate item in the Merchant Console epic. The current data supports a forecast range from **2027-07-18 through 2027-08-01**: the first date completes the controlling chain, while the later date covers all remaining open launch-epic work. I use **2027-07-25** and 2.5 sprints as the midpoint in the structured forecast because the source data does not specify which of those two defensible scopes leadership wants to commit to.
