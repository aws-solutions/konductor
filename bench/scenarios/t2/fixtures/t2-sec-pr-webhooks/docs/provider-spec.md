# Provider Webhook Specifications

## GitHub Webhooks

### Headers
- `X-GitHub-Event`: Event type
- `X-GitHub-Delivery`: Unique delivery ID
- `X-Hub-Signature-256`: HMAC-SHA256 signature

### Security Requirements
1. Verify signature using raw request body
2. Check delivery ID not seen in last 10 minutes
3. Validate event type is allowed

## Stripe Webhooks

### Headers  
- `Stripe-Signature`: Contains timestamp and signatures
- Content-Type: application/json

### Security Requirements
1. Parse signature header to extract timestamp
2. Verify timestamp within 5 minutes
3. Verify at least one signature matches
4. Check webhook ID not processed in last 15 minutes

## Generic Webhooks

### Headers
- `X-Signature`: HMAC signature
- `X-Timestamp`: Unix timestamp (optional)
- `X-Delivery-Id`: Unique identifier (optional)

### Security Requirements
1. If timestamp present, validate within 5 minutes
2. If delivery ID present, check uniqueness within configured window
3. Always verify signature against raw body