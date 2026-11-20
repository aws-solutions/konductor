# Update

I went through the exports. The plan mostly holds; the main items are below.

```status
{
 "overall": "red",
 "risks": [
  {
   "tickets": [
    "PLT-014",
    "PAY-021"
   ],
   "kind": "critical-path",
   "summary": "The 24-point open dependency chain starts with the unassigned certificate prerequisite in another epic and controls launch readiness.",
   "owner": "Platform launch owner"
  },
  {
   "tickets": [
    "PAY-028"
   ],
   "kind": "date-conflict",
   "summary": "PAY-028 is due before its PAY-021 prerequisite, so the recorded dates cannot both be met as written.",
   "owner": "Payments"
  }
 ],
 "critical_path": [
  "PLT-014",
  "PAY-021",
  "CHK-040"
 ],
 "revised_launch_date": "2027-07-04",
 "reasoning": {
  "remaining_points_on_critical_path": 17,
  "team_velocity_points_per_sprint": 13,
  "sprints_needed": 2
 },
 "capacity_by_sprint": {
  "S27": 17,
  "S28": 17,
  "S29": 17,
  "S30": 17
 },
 "scope_added_after_lock_points": 7
}
```
