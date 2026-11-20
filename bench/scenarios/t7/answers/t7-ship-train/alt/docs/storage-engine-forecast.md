# Answer

The figures below come from the files in this folder; the reasoning follows the data block.

```forecast
{
 "notes": [
  "2027.06 is the most likely train. The feature must remain flagged for one full train, making 2027.07 the customer promise.",
  "At 110 points and 30 ordinary points per sprint, four sprints finish in the sprint ending 2027-04-11, before the 2027-05-07 branch.",
  "WORK-1048 has a blank estimate and uses the Storage Engine workstream median of 8 points.",
  "WORK-1008 has a blank estimate and uses the Storage Engine workstream median of 8 points; its dependency is sequenced from the ticket export.",
  "Forecast scope is the 13 open tickets in the Storage Engine initiative; the separate archive-migration item is excluded."
 ],
 "excluded_tickets": [
  "WORK-1063"
 ],
 "sprints_needed": 4,
 "throughput_points_per_sprint": 30,
 "remaining_points": 110,
 "committed_release_date": "2027-07-30",
 "likely_branch_date": "2027-05-07",
 "committed_release": "2027.07",
 "likely_release": "2027.06"
}
```

## Reasoning

The comparable delivery record is 30 points per ordinary sprint. At that rate, 110 points require four sprints. Starting with the first sprint after the 2027-02-01 snapshot, that work reaches the sprint ending 2027-04-11, leaving room before the likely train's branch. Dependencies still need to be sequenced during delivery, so the likely date is a forecast rather than a guarantee.
The forecast covers the 13 open tickets in the `Storage Engine` initiative. Their remaining scope is 110 points. Two blank estimates, WORK-1008 and WORK-1048, use the Storage Engine workstream median of 8 points each. The separate archive-migration item is outside this forecast and is listed below.
The customer commitment is **2027.07**, released on 2027-07-30. The most likely train is **2027.06**, released on 2027-06-18. The work is expected to merge before the 2027-05-07 branch date for that likely train. The promise is one train later because the new feature must spend one complete train behind its flag before it can be enabled by default.
