# Runbook

## A quiet queue

Check `worker_jobs_total`, then compare queue age with the broker dashboard. If the worker is healthy but idle, inspect the queue binding before recycling a process.

## A stuck lease

Use the job id from the structured log, confirm that the lease owner is still alive, and let the retry window expire before replaying. Do not acknowledge a job from the dashboard.

## Configuration changes

The deploy controller stages a replacement file and renames it into place. A text editor may briefly leave a file with zero bytes while it saves, so an operator should wait for the file operation to finish before judging the worker. A restart is the normal way to make a setting active.

## Rollback

Return the image and configuration bundle to the previous release ring. Check readiness, queue age, and error rate before moving traffic back.
