# Relay API

The examples use `https://relay.example.test` as a documentation host. All request and response bodies use JSON. The `Authorization` value in examples is a documentation-only partner key.

## Receive an event

`POST /v1/events`

Partner systems send a normalized event to the relay. The `Authorization` header identifies the partner key. `X-Partner-Signature` carries the hexadecimal HMAC value calculated over the exact request body. `Content-Type` must be `application/json`.

```json
{
  "eventId": "evt-doc-0001",
  "tenantId": "tenant-demo",
  "type": "invoice.updated",
  "occurredAt": "2025-01-20T12:00:00Z",
  "data": { "invoiceId": "inv-example-42", "state": "paid" }
}
```

A successful request returns `202` and an envelope containing the event id and accepted state:

```json
{ "eventId": "evt-doc-0001", "status": "accepted" }
```

The sender may retry a request after a timeout. The relay does not promise that the response means the callback has completed.

## Register a callback

`POST /v1/callbacks`

An authenticated account owner supplies a display name and destination:

```json
{
  "name": "billing callback",
  "callbackUrl": "https://hooks.example.test/harborline/billing",
  "eventTypes": ["invoice.updated", "invoice.paid"]
}
```

The response includes a generated callback id and the saved URL. A callback is active immediately after creation.

## List recent events

`GET /v1/events?tenantId=tenant-demo&limit=25`

The account owner can request recent envelopes. `limit` defaults to 25. Each result includes `eventId`, `tenantId`, `type`, `occurredAt`, `storedAt`, and `data`.

## Delivery status

`GET /v1/deliveries/:eventId`

The response reports the callback id, current state, attempt count, and the next scheduled time. A failed delivery keeps the event available for later attempts.

## Administration

`POST /admin/replay/:eventId` asks the scheduler to put an event back in the delivery queue. `GET /admin/health` reports queue depth, database connectivity, and process version. These endpoints use the operations credential described in the sample configuration and are reachable on the private operations listener.

## Error shape

Errors use this shape:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "event body could not be parsed"
  }
}
```

Clients should use the code rather than matching the message. The service returns `400` for malformed JSON, `401` for an unknown partner key, `403` for an account that cannot use a resource, and `429` when the public request limiter rejects a call. Callback errors are recorded in delivery state rather than returned from the receive endpoint.
