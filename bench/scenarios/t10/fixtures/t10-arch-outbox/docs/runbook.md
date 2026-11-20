# Orders runbook

## Store unavailable

Check disk space and the store error counter. Do not remove the data file. Restore the host volume before restarting an instance.

## Broker unavailable

Check broker errors and the host adapter logs. A restart is safe after confirming the data file is intact.

## Bad request spike

Compare request errors with the deploy ring and inspect the request body-size limit.

## Time

Operational timestamps are UTC ISO strings.
