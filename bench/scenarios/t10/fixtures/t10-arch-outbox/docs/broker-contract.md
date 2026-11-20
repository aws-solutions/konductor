# Broker adapter contract

The host adapter accepts `publish(topic, message)`. It is at-least-once from the caller's point of view, may throw or return a promise that does not settle, and rejects a serialized topic and message larger than 2048 bytes. A successful call means the adapter accepted the message, not that a consumer finished it.
