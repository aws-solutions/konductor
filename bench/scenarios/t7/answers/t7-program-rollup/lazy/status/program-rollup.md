# Update

I went through the exports. The plan mostly holds; the main items are below.

```program-status
{
 "overall": "red",
 "teams": {
  "ARC": {
   "reported": "green",
   "actual": "amber",
   "remaining_points": 62
  },
  "BEAM": {
   "reported": "green",
   "actual": "red",
   "remaining_points": 58
  },
  "COVE": {
   "reported": "green",
   "actual": "amber",
   "remaining_points": 58
  }
 },
 "critical_path": [
  "ARC-117",
  "BEAM-224",
  "COVE-354"
 ],
 "cross_team_blockers": [
  {
   "tickets": [
    "ARC-117",
    "BEAM-224"
   ],
   "summary": "The Arc handoff is blocked in Beam and holds the Cove bridge acceptance sequence."
  }
 ],
 "duplicates": [
  [
   "ARC-143"
  ]
 ],
 "milestone_at_risk": "Relay milestone is at risk: forecast 2027-11-26 versus target 2027-10-15.",
 "forecast_date": "2027-11-05"
}
```
