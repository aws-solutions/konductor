# Pulse notification service

Pulse is a small CommonJS service used by internal dashboards to fan out user notifications. It has no runtime dependencies and targets Node.js 24.

## Quick start

```sh
npm test
node src/cli.js --user demo
```

The service exposes an in-memory event bus, a websocket-like `WebSocketStub`, and a heartbeat for idle connections. The command-line sample writes its messages to stdout and exits when stdin closes.

## Library entry points

`require('./src')` exports `EventBus`, `NotificationService`, `WebSocketStub`, and `Heartbeat`. The service accepts a user ID and a connection in `connect(userId, connection)`, sends a notification with `notify(userId, payload)`, and can register application callbacks with `subscribe(userId, handler)`.

Configuration is read from `config/default.json`; tests use `config/test.json`. See `docs/architecture.md` for the small object model and `docs/operations.md` for deployment notes.
