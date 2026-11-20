# Update

I went through the exports. The plan mostly holds; the main items are below.

```forecast
{
 "can_hit_target": false,
 "target_date": "2027-03-10",
 "earliest_date": "2027-04-09",
 "critical_path": [
  "MIG-014",
  "MIG-032",
  "MIG-057",
  "MIG-071",
  "MIG-142"
 ],
 "drivers": [
  {
   "tickets": [
    "MIG-014",
    "MIG-032"
   ],
   "why": "The upstream mapping, backfill, and validation sequence runs through the S4-S6 runway before runtime work can start."
  },
  {
   "tickets": [
    "MIG-057"
   ],
   "why": "The cross-team handoff is limited to Tuesday and Wednesday, and Dae Okafor's March 29-April 2 leave pushes the next workable acceptance to April 6."
  },
  {
   "tickets": [
    "MIG-071"
   ],
   "why": "MIG-071 is owned by the person on leave and its sprint also loses the March 31 and April 2 holidays, leaving only 60 aggregate points in S7."
  }
 ],
 "capacity_by_sprint": {
  "S1": 55,
  "S2": 50,
  "S3": 55,
  "S4": 50,
  "S5": 55,
  "S6": 55,
  "S7": 42,
  "S8": 53,
  "S9": 55
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
