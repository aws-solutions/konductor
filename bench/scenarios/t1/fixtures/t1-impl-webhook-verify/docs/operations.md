# Operations

The service has no external datastore. Restarting it clears the ledger, so the process is intended for local reconciliation and short-lived workers rather than the accounting system of record.

Check `GET /health` before routing traffic. The callback endpoint returns JSON for both success and client errors. Logs contain a request id and route, but not request bodies.

The default port is 8080. Set `PORT` when running more than one local instance, and set `LEDGER_LABEL` to distinguish their dashboard output.
