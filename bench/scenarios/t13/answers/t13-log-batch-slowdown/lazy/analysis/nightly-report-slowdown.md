# Nightly reporting slowdown

## Executive finding

The sustained slowdown begins on the 2026-04-03 run. The `enrich` stage is the bottleneck, and it is the same work later logged as `enrich-v2`. Its duration increases by about 8 minutes per night, while the other stages add only about a minute in total as input grows. The input row count grows smoothly at about 3% per night, so volume explains the small background increase but not the step change in this stage.

## Timeline and trend

The first two runs finish at 04:05 and 04:06 UTC. The 2026-04-03 run finishes at 04:18 UTC, immediately after the worker reduction. From there, the normal finish trend advances roughly 8 minutes per night. The 2026-04-09 observed finish at 07:40 UTC is excluded from that trend because publish failed twice and retried. The next normal finish is 05:38 UTC, consistent with the underlying trend after the outlier night.

## Action

Revert enrich parallelism from 2 back to 8 workers. The colleague confirmed that the lookup service was upgraded on 2026-04-07, so the reason for the cut is gone. Verify the next run's enrich duration and lookup-service health before treating the regression as closed. Keep the 01:00 UTC start: upstream data lands at 00:45 UTC, and an earlier start is not possible. The publish retry event should remain a separate follow-up for delivery reliability.

## Colleague-confirmed operating facts

- Finance's deadline is 06:30 UTC. This came from the colleague.
- The lookup service upgrade on 2026-04-07 means the worker setting can return to 8. This came from the colleague.
- Upstream data lands at 00:45 UTC and the job already starts at 01:00 UTC, so it cannot start earlier. This came from the colleague.

## Evidence

- `config/history.md:68` records the 2026-04-03 reduction from 8 to 2 enrich workers.
- `logs/night-2026-04-03.log:185` records `enrich` with two workers on the first slow night.
- `logs/night-2026-04-06.log:185` records the renamed `enrich-v2` stage still using two workers.
- `logs/night-2026-04-09.log:192` records the separate publish failure that makes that night an outlier.

```json
{
 "firstSlowNight": "2026-03-13",
 "slowStage": "enrich-v2",
 "cause": {
  "summary": "The enrich parallelism was reduced from 8 to 2 workers, cutting concurrency against the lookup service and creating the sustained capacity regression.",
  "evidence": [
   "config/history.md:68",
   "logs/night-2026-04-03.log:185"
  ]
 },
 "growthMinutesPerNight": 8,
 "finishTimes": [
  {
   "night": "2026-03-11",
   "finishUtc": "04:05"
  },
  {
   "night": "2026-03-12",
   "finishUtc": "04:06"
  },
  {
   "night": "2026-03-13",
   "finishUtc": "04:18"
  },
  {
   "night": "2026-03-14",
   "finishUtc": "04:30"
  },
  {
   "night": "2026-03-15",
   "finishUtc": "04:41"
  },
  {
   "night": "2026-03-16",
   "finishUtc": "04:52"
  },
  {
   "night": "2026-03-17",
   "finishUtc": "05:04"
  }
 ],
 "deadlineUtc": "06:30",
 "predictedMissNight": "2026-03-25",
 "excludedNights": [
  {
   "night": "2026-03-19",
   "why": "Publish failed twice and retried, adding an isolated delivery delay after enrich completed."
  }
 ],
 "recommendation": "Revert enrich parallelism from 2 back to 8 workers now that the lookup service was upgraded. Keep the 01:00 UTC start because upstream data lands at 00:45; an earlier start is not possible."
}
```
