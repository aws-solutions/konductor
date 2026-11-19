# Relay program status

**Bottom line: red.** The three team updates are green, but the exports show a blocked Beam handoff between Arc and Cove. The published capacity does not cover the current open Relay work until the sprint ending 2027-11-26, which is after the 2027-10-15 milestone target.

## Team view

| Team | Reported | Actual | Remaining Relay points |
| --- | --- | --- | ---: |
| ARC | green | amber | 88 |
| BEAM | green | red | 83 |
| COVE | green | amber | 83 |

The actual colors use the documented open-status convention. The blocked Relay ticket is BEAM-224, and the upstream and downstream tickets make the impact cross-team. Arc's paragraph reports 24 points of velocity, while its export has 57 completed points in the most recent completed sprint S-08, so I used the export for the work rollup. Blank estimates contribute zero. ARC-143 appears in both the ARC and COVE extracts and is counted once, under ARC, rather than twice.

## Critical dependency and forecast

The dependency chain is `ARC-117 → BEAM-224 → COVE-331 → COVE-342`. ARC-117's `blocks` field, BEAM-224's `depends_on` field, and Cove's free-text `needs` references all point to the same handoff sequence. COVE-354 is a blocked Harbor maintenance ticket, so it is outside Relay scope and does not change the program color or path.

The deduplicated open Relay total is 254 points. Starting with S-10 on 2027-09-06, the capacity sheets provide 42, 45, 42, 45, 42, and 45 points through S-15. The first sprint that covers the total ends on 2027-11-26. The 2027-09-06 holiday is already reflected in S-10's available capacity.

```program-status
{
  "overall": "red",
  "teams": {
    "ARC": {
      "reported": "green",
      "actual": "amber",
      "remaining_points": 88
    },
    "BEAM": {
      "reported": "green",
      "actual": "red",
      "remaining_points": 83
    },
    "COVE": {
      "reported": "green",
      "actual": "amber",
      "remaining_points": 83
    }
  },
  "critical_path": [
    "ARC-117",
    "BEAM-224",
    "COVE-331",
    "COVE-342"
  ],
  "cross_team_blockers": [
    {
      "tickets": [
        "ARC-117",
        "BEAM-224",
        "COVE-331",
        "COVE-342"
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
  "forecast_date": "2027-11-26"
}
```
