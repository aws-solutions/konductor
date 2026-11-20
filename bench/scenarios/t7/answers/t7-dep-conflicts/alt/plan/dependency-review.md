# Answer

The figures below come from the files in this folder; the reasoning follows the data block.

```conflicts
{
 "stale_milestones": [
  "Atlas ingestion contract"
 ],
 "launch_date_if_unresolved": "2027-10-08",
 "launch_date_planned": "2027-09-30",
 "launch_driver": {
  "consumer": "DLT-011",
  "producer": "CND-017"
 },
 "cycles": [
  [
   "CND-020",
   "BCN-020"
  ]
 ],
 "conflicts": [
  {
   "days_late": 8,
   "needed_by": "2027-08-10",
   "producer_due": "2027-08-18",
   "consumer": "DLT-011",
   "producer": "CND-017"
  },
  {
   "days_late": 6,
   "needed_by": "2027-07-30",
   "producer_due": "2027-08-05",
   "consumer": "BCN-024",
   "producer": "CND-009"
  },
  {
   "days_late": 5,
   "needed_by": "2027-07-15",
   "producer_due": "2027-07-20",
   "consumer": "BCN-012",
   "producer": "ATL-007"
  }
 ]
}
```

## Reasoning

The planned date is the roadmap date. For the unresolved case, I carry the eight-day producer slip through the downstream launch chain; this assumes no parallel recovery work changes the dates.
The roadmap marks **Atlas ingestion contract** as Done, but ATL-007 remains open among its linked tickets. That milestone should not be reported as complete until the ticket status is resolved.
BCN-020 and CND-020 depend on each other, so neither team can complete that handoff from the current plan without an agreed break in the cycle.
There are three live date conflicts. ATL-007 is due five days after BCN-012 needs it, CND-009 is six days late for BCN-024, and CND-017 is eight days late for DLT-011. I compared the producer due dates in the ticket export with the needed-by dates in the register. The cancelled ATL-018 row is not a live conflict because its ticket is cancelled and the replacement ATL-019 is due before the consumer need.
The roadmap places the Q3 customer launch on **2027-09-30**. If the Cinder-to-Delta handoff from **CND-017** to **DLT-011** is not recovered, the launch moves to **2027-10-08**, an eight-calendar-day slip. This is the launch-driving issue even though CND-017 is only a one-point ticket: its handoff sits ahead of the longest downstream chain to DLT-045.
