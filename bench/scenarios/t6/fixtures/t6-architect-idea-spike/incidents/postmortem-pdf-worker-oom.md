# INC-2025-014: render workers killed on a long statement (June 2025)

Author: Tomas. Status: closed.

## Summary
On Tue 17 Jun a monthly statement for tenant t046 (135 pages) was queued. The worker handling it was killed by the container memory limit (256 MB at the time). The queue retried the job, which killed the next worker. Four workers died in a row. Statement and ordinary PDF requests queued for 47 minutes.

## Timeline (UTC)
- 09:12 job enqueued by the nightly statement run
- 09:14 worker 2 OOM-killed; job re-queued
- 09:16 worker 4 OOM-killed
- 09:19 worker 1 OOM-killed; support starts getting "PDF stuck" messages
- 09:26 on-call pages Tomas
- 09:41 job pulled off the queue by hand
- 09:59 workers back to normal; backlog drained

## Memory profile (taken afterwards, one worker, same renderer build)

| pages | peak RSS (MB) |
|---|---|
| 0 (idle, fonts loaded) | 20 |
| 1 | 22 |
| 12 | 44 |
| 30 | 80 |
| 60 | 140 |
| 98 | 216 |
| 135 | 290 |

## What we changed
- Worker memory raised from 256 MB to 1 GB.
- Retry limit of 1 per job (it used to be unlimited).

## Not done
- A page-count guard that refuses to render above a ceiling.
- Splitting very long statements.
