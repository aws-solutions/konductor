# Operations

Run `node src/cli.js --user <id>` for a local smoke check. The process reads stdin so it can be used in a pipeline. Set `NODE_ENV=test` when running the test suite to keep the logger quiet.

The default heartbeat is 30 seconds. Test configuration uses a shorter interval. A service instance should be closed when its owning server shuts down. Heartbeat timers are unreferenced, and `close()` or `disconnect()` stops them immediately.

When a connection is disconnected or emits its close event, its event-bus listener is removed before later notifications are published. Application handler errors are isolated and reported through the optional `onHandlerError` constructor callback, so another subscriber can still receive the notification.

Payloads are in memory and are not replayed after a process restart. A deployment that needs replay should put a durable store behind the service boundary.
