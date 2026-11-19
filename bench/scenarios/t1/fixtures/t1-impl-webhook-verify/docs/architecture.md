# Architecture notes

The process has three layers. `src/server.js` turns node:http requests into route calls, `src/router.js` maps paths to handlers, and handlers own response details. The ledger is a synchronous in-memory object because callbacks are processed one at a time in this small service.

A callback record contains an `id`, an optional `type`, an integer `amount`, and a three-letter `currency`. The ledger keeps the first record for each id and exposes the running balance and ids for the dashboard.
