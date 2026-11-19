# Operations

The worker uses a JSON file as a simple local queue. Keep the queue file on durable local storage and avoid editing it while the worker is running.

Logs are JSON objects with a level, message, and useful job fields. `SIGINT` and `SIGTERM` stop the polling loop after its current operation.

For a stuck local queue, stop the worker, make a backup of the JSON file, and use `scripts/inspect-queue.js` before editing records.
