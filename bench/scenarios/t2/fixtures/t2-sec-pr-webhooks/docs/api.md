# API Reference

## Webhook Endpoints

### `POST /webhooks/github`
Receive GitHub webhooks.

**Headers:**
- `X-Hub-Signature-256`: HMAC-SHA256 signature
- `X-GitHub-Delivery`: Unique delivery ID
- `X-GitHub-Event`: Event type

**Response:**
- `200`: Webhook received successfully
- `400`: Invalid request or duplicate delivery
- `401`: Invalid signature

### `POST /webhooks/stripe`
Receive Stripe webhooks.

**Headers:**
- `Stripe-Signature`: Signature with timestamp

**Response:**
- `200`: Webhook received successfully
- `400`: Invalid request
- `401`: Invalid signature

### `POST /webhooks/generic`
Receive generic webhooks.

**Headers:**
- `X-Signature`: HMAC-SHA256 signature (format: `sha256=<hex>`)
- `X-Delivery-Id`: Optional delivery ID
- `X-Timestamp`: Optional Unix timestamp
- `X-Callback-Url`: Optional callback URL

**Response:**
- `200`: Webhook received successfully
- `400`: Invalid request or duplicate delivery
- `401`: Invalid signature

### `POST /notify`
Forward notification to customer endpoint.

**Body:**
```json
{
  "url": "https://example.com/webhook",
  "payload": { "event": "data" },
  "secret": "notification_secret"
}
```

**Response:**
- `200`: Notification forwarded
- `400`: Missing required fields
- `401`: Invalid secret
- `500`: Forwarding failed

## Health Check

### `GET /health`
Check service status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-11-19T18:30:00Z",
  "version": "2.2.0"
}
```

## Authentication

All webhook endpoints require signature verification using a shared secret.

## Rate Limiting

Endpoints are rate-limited to 100 requests per minute per IP address.

## Error Handling

All endpoints return JSON error responses:
```json
{
  "error": "Error description"
}
```