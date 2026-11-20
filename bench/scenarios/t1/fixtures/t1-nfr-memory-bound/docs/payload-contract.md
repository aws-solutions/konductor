# Payload contract

A delivery has this shape:

```json
{
  "idempotencyKey": "provider-event-123",
  "payload": { "type": "invoice.created" }
}
```

The key is supplied by the provider. The payload is passed to the application callback without reshaping.
