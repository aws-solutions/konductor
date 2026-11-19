# Architecture

The service has three small layers. `NotificationService` maps a user ID to an event-bus topic and delivers payloads to connected websocket-like objects. `EventBus` owns topic listeners and provides an asynchronous publish operation. `Heartbeat` keeps an idle connection active at a configurable interval.

The `WebSocketStub` is deliberately small: it records sent payloads, counts pings, and exposes `open`, `close`, and `message` events through the usual event-emitter interface. Production adapters can replace it without changing the service.

The memory store and metrics objects are optional building blocks used by the examples. They do not persist data between processes.
