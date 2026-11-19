# Next three sprints

The plan commits the estimated open beta scope in ticket order while keeping prerequisites visible. The bottom line is that most estimated must-have work fits across the three sprints, but payment sandbox checkout cannot be committed with the current payments capacity, and the service dashboard has no estimate. Those two items need a decision before the beta date.

Capacity uses Monday-Friday dates inclusively, removes the listed holidays, applies each person's focus factor, and halves that person's daily capacity on on-call days. The resulting team capacities are 35.23 points in 2027-S1, 22.49 in 2027-S2, and 34.785 in 2027-S3. S1 is intentionally ordered around the prerequisite for readiness checks. The payment sandbox data is pulled in even though checkout itself is not committed, so the payment work is visible rather than silently dropped.

| Sprint | Commitment | Points | Capacity |
|---|---|---:|---:|
| 2027-S1 | T-011, T-023, T-037, T-049, T-061, T-068, T-083 | 31 | 35.23 |
| 2027-S2 | T-108, T-113 | 16 | 22.49 |
| 2027-S3 | T-119 | 8 | 34.785 |

T-083 follows its pulled-in QA fixture dependency T-037. T-108 follows T-023, which is already in S1. Gale Park is the only person with the payments skill. The payment bundle is 11 points in the S1 view, against Gale's 3.6-point capacity, so this is an explicit capacity exception rather than an implied commitment. T-074 remains outside the sprint lists until that specialist constraint changes. T-096 remains outside the plan because its blank estimate is not zero.

```sprint-plan
{
  "capacity_by_sprint": {
    "2027-S1": 35.23,
    "2027-S2": 22.49,
    "2027-S3": 34.785
  },
  "sprints": {
    "2027-S1": ["T-011", "T-023", "T-037", "T-049", "T-061", "T-068", "T-083"],
    "2027-S2": ["T-108", "T-113"],
    "2027-S3": ["T-119"]
  },
  "not_fitting": ["T-074", "T-096"],
  "pulled_in_dependencies": ["T-037", "T-068"],
  "over_allocated": [
    {"person": "Gale Park", "sprint": "2027-S1", "assigned": 11, "capacity": 3.6}
  ],
  "unestimated": ["T-096"]
}
```
