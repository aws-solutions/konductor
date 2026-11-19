# Runbook

1. Confirm the scheduler payload contains an ISO date.
2. Run the local command with `node src/index.js --date YYYY-MM-DD`.
3. Compare the returned item count with the source dashboard.
4. Keep the structured log and manifest together when opening an operations ticket.

The local client records requests in memory and never writes credentials to disk.
