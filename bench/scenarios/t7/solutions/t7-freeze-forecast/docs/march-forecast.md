# March migration forecast

**Bottom line:** No, we cannot land the gated migration work by March 31, 2027. The earliest realistic completion date is **April 30, 2027**, which is after the April 12 feature freeze and therefore does not support an unchanged frozen release plan. The May 3 final date leaves almost no stabilization margin and requires a freeze exception or a reset of the release date.

The release calendar puts the feature freeze on April 12, exactly three weeks before the May 3 final. The gated chain runs through MIG-014, MIG-032, MIG-057, MIG-071, MIG-088, MIG-109, and MIG-126. The chain reaches April 30 when the planned sprints, holidays, leave, owner availability, and receiving-team handoff days are applied.

The main drivers are:

- **MIG-014 → MIG-032 → MIG-057:** This is the upstream preparation and validation sequence. It finishes on March 29, so it already consumes nearly all of the S4-S6 runway before the runtime work can begin.
- **MIG-057 → MIG-071:** Runtime Migration accepts cross-team handoffs only on Tuesdays and Wednesdays. Dae Okafor owns MIG-071 and is on leave from March 29 through April 2. The next workable acceptance is April 6, and the eight-point adapter finishes April 15.
- **MIG-088 → MIG-109:** The rollback rehearsal finishes April 22. Release Operations accepts that handoff on its Monday/Thursday schedule, so MIG-109 starts April 26 and finishes April 28 instead of starting immediately on the next weekday.
- **MIG-126:** Its consuming dependency requests acceptance by April 14, two days after the April 12 freeze. Hana Reed's April 12-14 leave also reduces S8 capacity. This is a date conflict, not a reason to silently move the freeze.

The aggregate capacity after holidays and planned leave is 71 points in S2, 71 in S4, 60 in S7, and 76 in S8. The full sprint view is 79, 71, 79, 71, 79, 79, 60, 76, and 79 points for S1 through S9. The March 31 holiday and Dae's leave both hit S7; Hana's leave hits S8. The large 55-point MIG-142 reporting epic has no dependency path into this chain and can slip without moving this forecast.

If the April 12 freeze is firm, the migration should be removed from the May 3 release or the scope should be reduced to work that can pass the freeze. If the release date is more important, the director needs to approve a freeze exception and accept the short stabilization window.

```forecast
{
  "can_hit_target": false,
  "target_date": "2027-03-31",
  "earliest_date": "2027-04-30",
  "critical_path": [
    "MIG-014",
    "MIG-032",
    "MIG-057",
    "MIG-071",
    "MIG-088",
    "MIG-109",
    "MIG-126"
  ],
  "drivers": [
    {
      "tickets": ["MIG-014", "MIG-032", "MIG-057"],
      "why": "The upstream mapping, backfill, and validation sequence runs through the S4-S6 runway before runtime work can start."
    },
    {
      "tickets": ["MIG-057", "MIG-071"],
      "why": "The cross-team handoff is limited to Tuesday and Wednesday, and Dae Okafor's March 29-April 2 leave pushes the next workable acceptance to April 6."
    },
    {
      "tickets": ["MIG-071"],
      "why": "MIG-071 is owned by the person on leave and its sprint also loses the March 31 and April 2 holidays, leaving only 60 aggregate points in S7."
    },
    {
      "tickets": ["MIG-088", "MIG-109"],
      "why": "The Runtime Migration to Release Operations handoff waits for the receiving team's Monday/Thursday acceptance days, extending the calendar beyond the point count."
    },
    {
      "tickets": ["MIG-126"],
      "why": "Its April 14 dependency due date is after the April 12 freeze, while Hana Reed's April 12-14 leave reduces S8 to 76 points."
    }
  ],
  "capacity_by_sprint": {
    "S1": 79,
    "S2": 71,
    "S3": 79,
    "S4": 71,
    "S5": 79,
    "S6": 79,
    "S7": 60,
    "S8": 76,
    "S9": 79
  },
  "assumptions": [
    "Statuses marked open in status-codes.csv are included; Closed and Cancelled tickets are excluded.",
    "A holiday or inclusive PTO removes one point for that person on that working day, and overlapping absences are counted once.",
    "Ticket dependencies must be accepted before the dependent ticket starts, and a cross-team handoff waits for the receiving team's listed acceptance weekday.",
    "The April 12 freeze and May 3 final dates in release-calendar.csv remain fixed unless the director approves a change.",
    "MIG-142 is independent of the gated chain and may slip without changing this date."
  ]
}
```
