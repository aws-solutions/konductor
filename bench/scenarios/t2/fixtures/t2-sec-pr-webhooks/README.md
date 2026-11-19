# Webhook Integration Service

Secure webhook receiver that validates signatures from providers and forwards payloads to customer-configured endpoints.

## Supported Providers

- **GitHub**: Receives push, pull_request, and deployment events
- **Stripe**: Receives payment_intent, charge, and subscription events
- **Generic**: Signature-based validation for custom webhooks

## Configuration

Set environment variables:

```bash
WEBHOOK_SECRET=your_shared_secret
PORT=3000
LOG_LEVEL=info
```

## Security

- HMAC signature verification for all incoming webhooks
- Timestamp validation to prevent replay attacks
- Rate limiting per customer endpoint
- No internal network access from callback URLs

## Development

```bash
npm test
npm start
```