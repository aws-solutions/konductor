# Selected incident list

## RR-221, 2025-08-19

At 14:32 UTC, websocket connection errors rose while a session-router release was in progress. The first page named database latency because room writes also slowed. Database CPU and commit latency stayed within their normal bands. Session-router logs recorded upstream connection-pool waiting followed by retries from already-connected clients. The nearby change record includes a per-host upstream-pool setting transition from 240 to 120. The incident was contained by stopping the rollout and restoring the prior setting.

## RR-217, 2025-08-07

A presence-worker binary increased room fanout latency for nine minutes. The release was stopped after the first zone and no customer data was lost. The alert fired before the second zone began.

## RR-209, 2025-07-29

A database migration exposed an old client query for six minutes. The additive compatibility step was missing from the change record. The application rollback was safe because both binaries still understood the old column.

The list is incomplete and is retained for release planning context.
