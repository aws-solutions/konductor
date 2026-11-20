# Scope replan for the 18 June launch

## Bottom line

Keep the launch on **2027-07-16**. The post-lock net-new work is 29 points, while the remaining holiday-adjusted slack is 17 points. We therefore need to remove **12 points** from the planned scope.

## What changed

The active, net-new tickets created after the 2027-05-07 scope lock total 29 points:

- PRJ-1008, account export permission: 3 points
- PRJ-1031, audit event filters: 5 points
- PRJ-1064, bulk invitation validation: 8 points
- PRJ-1097, mobile approval notice: 5 points
- PRJ-1128, regional retention settings: 5 points
- PRJ-1156, usage threshold alert: 3 points

PRJ-1019 and PRJ-1073 are not additional net scope. They are bug splits whose points were taken out of their pre-lock parents: 3 points from PRJ-1004 and 2 points from PRJ-1022.

## Capacity and cuts

The capacity calculation is 17 points of slack: 44 - 0 - 37 = 7 in S12, 48 - 4 - 41 = 3 in S13, and 45 - 2 - 36 = 7 in S14. The difference between 29 added points and 17 slack points is the required 12-point cut.

Defer these two stretch items:

- **PRJ-1114**, refresh legacy import help text: 5 points
- **PRJ-1162**, clean up old provisioning notes: 7 points

PRJ-1046 looks like a stretch item, but I would keep it. The must-have PRJ-1102 depends on the permission summary data it provides, so cutting it would break a must-have item rather than remove independent optional work.

PRJ-1008 is a customer commitment recorded in the product request notes. It cannot be part of the cut.

```replan
{
  "added_after_lock": [
    "PRJ-1008",
    "PRJ-1031",
    "PRJ-1064",
    "PRJ-1097",
    "PRJ-1128",
    "PRJ-1156"
  ],
  "added_points": 29,
  "slack_points": 17,
  "points_to_cut": 12,
  "cut": [
    "PRJ-1114",
    "PRJ-1162"
  ],
  "keep_despite_optional": [
    "PRJ-1046"
  ],
  "cannot_cut": [
    "PRJ-1008"
  ],
  "date": "2027-07-16"
}
```
