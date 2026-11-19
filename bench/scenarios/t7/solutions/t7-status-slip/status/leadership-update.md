# Leadership update: payments and checkout

**Overall: red.** The planned 2027-06-25 launch is no longer reachable. The dependency chain that controls readiness has 24 open points and starts with an unassigned certificate item in the Merchant Console epic. The current data supports a forecast range from **2027-07-18 through 2027-08-01**: the first date completes the controlling chain, while the later date covers all remaining open launch-epic work. I use **2027-07-25** and 2.5 sprints as the midpoint in the structured forecast because the source data does not specify which of those two defensible scopes leadership wants to commit to.

### Leadership attention

- **Critical dependency:** Assign an owner to **PLT-014** and confirm the vendor certificate handoff. The dependency then runs through PAY-021, CHK-017, and CHK-026 in that order. Filtering only to the launch epic would omit the first prerequisite.
- **Date conflict:** PAY-028 is due 2027-06-26 even though its PAY-021 prerequisite is due 2027-06-28. Replan the dates or confirm which recorded date is stale.
- **Capacity:** Jon Bell has 13 open points assigned in S28 on PAY-031, against 0.9 adjusted capacity after the 2027-06-23 holiday. Move that work or provide an explicit staffing change before S28 begins. The adjusted total S28 capacity is 23.58 normalized planning points, compared with the roadmap velocity of 18 delivered points per sprint.
- **Scope:** PAY-034, CHK-037, and RISK-023 were created after the 2027-05-28 scope lock and add 10 points. Defer them or explicitly accept the later forecast.

The blocked CHK-040 item is not included as a launch risk because its CHK-041 prerequisite is already done. The export also contains ordinary closed, cancelled, blank-estimate, and reopened records; blank estimates are not included in point totals.

```status
{
  "overall": "red",
  "risks": [
    {
      "tickets": ["PLT-014", "PAY-021", "CHK-017", "CHK-026"],
      "kind": "critical-path",
      "summary": "The 24-point open dependency chain starts with the unassigned certificate prerequisite in another epic and controls launch readiness.",
      "owner": "Platform launch owner"
    },
    {
      "tickets": ["PAY-028", "PAY-021"],
      "kind": "date-conflict",
      "summary": "PAY-028 is due before its PAY-021 prerequisite, so the recorded dates cannot both be met as written.",
      "owner": "Payments"
    },
    {
      "tickets": ["PAY-031"],
      "kind": "over-allocation",
      "summary": "Jon Bell has 13 assigned open points in S28 against 0.9 holiday-adjusted capacity.",
      "owner": "Jon Bell"
    },
    {
      "tickets": ["PAY-034", "CHK-037", "RISK-023"],
      "kind": "scope-creep",
      "summary": "Three launch-epic tickets created after the 2027-05-28 lock add 10 points.",
      "owner": "Launch product lead"
    }
  ],
  "critical_path": ["PLT-014", "PAY-021", "CHK-017", "CHK-026"],
  "revised_launch_date": "2027-07-25",
  "reasoning": {
    "remaining_points_on_critical_path": 24,
    "team_velocity_points_per_sprint": 18,
    "sprints_needed": 2.5
  },
  "capacity_by_sprint": {
    "S27": 23.8,
    "S28": 23.58,
    "S29": 23.68,
    "S30": 23.8
  },
  "scope_added_after_lock_points": 10
}
```