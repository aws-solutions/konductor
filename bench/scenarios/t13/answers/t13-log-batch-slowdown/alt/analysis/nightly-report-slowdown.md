# Nightly reporting slowdown

## Evidence

- `config/history.md:68` records the 2026-04-03 reduction from 8 to 2 enrich workers.
- `logs/night-2026-04-03.log:185` records `enrich` with two workers on the first slow night.
- `logs/night-2026-04-06.log:185` records the renamed `enrich-v2` stage still using two workers.
- `logs/night-2026-04-09.log:192` records the separate publish failure that makes that night an outlier.

```json
{
 "recommendation": "Revert enrich parallelism from 2 back to 8 workers now that the lookup service was upgraded. Keep the 01:00 UTC start because upstream data lands at 00:45; an earlier start is not possible.",
 "excludedNights": [
  {
   "why": "In short: Publish failed twice and retried, adding an isolated delivery delay after enrich completed.",
   "night": "2026-04-09"
  }
 ],
 "predictedMissNight": "2026-04-15",
 "deadlineUtc": "06:30",
 "finishTimes": [
  {
   "finishUtc": "06:24",
   "night": "2026-04-14"
  },
  {
   "finishUtc": "06:12",
   "night": "2026-04-13"
  },
  {
   "finishUtc": "06:01",
   "night": "2026-04-12"
  },
  {
   "finishUtc": "05:49",
   "night": "2026-04-11"
  },
  {
   "finishUtc": "05:38",
   "night": "2026-04-10"
  },
  {
   "finishUtc": "07:40",
   "night": "2026-04-09"
  },
  {
   "finishUtc": "05:15",
   "night": "2026-04-08"
  },
  {
   "finishUtc": "05:04",
   "night": "2026-04-07"
  },
  {
   "finishUtc": "04:52",
   "night": "2026-04-06"
  },
  {
   "finishUtc": "04:41",
   "night": "2026-04-05"
  },
  {
   "finishUtc": "04:30",
   "night": "2026-04-04"
  },
  {
   "finishUtc": "04:18",
   "night": "2026-04-03"
  },
  {
   "finishUtc": "04:06",
   "night": "2026-04-02"
  },
  {
   "finishUtc": "04:05",
   "night": "2026-04-01"
  }
 ],
 "growthMinutesPerNight": 11,
 "cause": {
  "evidence": [
   "logs/night-2026-04-09.log:192",
   "logs/night-2026-04-06.log:185",
   "logs/night-2026-04-03.log:185",
   "config/history.md:68"
  ],
  "summary": "In short: The enrich parallelism was reduced from 8 to 2 workers, cutting concurrency against the lookup service and creating the sustained capacity regression."
 },
 "slowStage": "enrich-v2",
 "firstSlowNight": "2026-04-03"
}
```

## Colleague-confirmed operating facts

- Finance's deadline is 06:30 UTC. This came from the colleague.
- The lookup service upgrade on 2026-04-07 means the worker setting can return to 8. This came from the colleague.
- Upstream data lands at 00:45 UTC and the job already starts at 01:00 UTC, so it cannot start earlier. This came from the colleague.

## Action

Revert enrich parallelism from 2 back to 8 workers. The colleague confirmed that the lookup service was upgraded on 2026-04-07, so the reason for the cut is gone. Verify the next run's enrich duration and lookup-service health before treating the regression as closed. Keep the 01:00 UTC start: upstream data lands at 00:45 UTC, and an earlier start is not possible. The publish retry event should remain a separate follow-up for delivery reliability.

## Timeline and trend

The first two runs finish at 04:05 and 04:06 UTC. The 2026-04-03 run finishes at 04:18 UTC, immediately after the worker reduction. From there, the normal finish trend advances roughly 11 minutes per night. The 2026-04-09 observed finish at 07:40 UTC is excluded from that trend because publish failed twice and retried. The next normal finish is 05:38 UTC, consistent with the underlying trend after the outlier night.

Finance needs the reports by 06:30 UTC. This deadline came from the colleague. On the normal trend, the 2026-04-14 run finishes at 06:24 UTC and the next run is about 11 minutes later, at 06:35 UTC. Therefore the first predicted miss is 2026-04-15.

## Executive finding

The sustained slowdown begins on the 2026-04-03 run. The `enrich` stage is the bottleneck, and it is the same work later logged as `enrich-v2`. Its duration increases by about 11 minutes per night, while the other stages add only about a minute in total as input grows. The input row count grows smoothly at about 3% per night, so volume explains the small background increase but not the step change in this stage.

The strongest correlation is the 2026-04-03 configuration change from 8 to 2 enrich workers to reduce lookup-service load. The 2026-04-03 log records the stage running with two workers, and the later `enrich-v2` records continue to show two workers. This is a capacity regression in the enrich worker pool, not a general warehouse-volume problem. The publish failure on 2026-04-09 is a separate delivery outlier: it added retries and delay after enrich had completed and should not be used to fit the ongoing trend.
