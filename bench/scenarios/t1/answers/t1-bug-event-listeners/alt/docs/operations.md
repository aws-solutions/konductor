# Operations Notes

## Memory and Connection Management

### Event Listener Cleanup (v2.4.1)

The notification service now properly removes event bus listeners on disconnect. Previously, reconnecting without an explicit disconnect would accumulate listeners, causing:
- Memory growth over time
- Duplicate notification delivery

This is resolved by calling `bus.off()` in the disconnect path.

### Heartbeat Timer Behavior

Heartbeat timers use `unref()` to avoid keeping the Node.js event loop alive. This ensures test processes and long-running scripts can exit cleanly when only heartbeat timers remain.

### Idempotent Operations

All connection lifecycle operations are now idempotent:
- `connect()` with the same user and connection returns the existing session
- `disconnect()` returns `true` once, then `false` on subsequent calls
- `close()` can be called multiple times safely

### Callback Error Isolation

The event bus now isolates failing handlers. If one subscriber throws (sync or async), other subscribers and socket delivery continue unaffected.
