# Security Considerations

## Signature Verification

All incoming webhooks must be signed with a shared secret using HMAC-SHA256. The signature is transmitted in the `X-Webhook-Signature` header.

### Provider Requirements

#### GitHub
- Uses `X-Hub-Signature-256` header
- Format: `sha256=<hexdigest>`
- Body must be raw request body (not parsed JSON)
- Replay protection: delivery ID must be unique within 10 minutes

#### Stripe
- Uses `Stripe-Signature` header  
- Contains timestamp and signatures
- Timestamp must be within 5 minutes of current time
- Delivery ID must be unique within 15 minutes

#### Generic Webhooks
- Uses `X-Signature` header
- Format: `sha256=<hexdigest>`
- Timestamp validation required if `X-Timestamp` header present
- Delivery ID must be checked if `X-Delivery-Id` header present

## Replay Attack Prevention

To prevent replay attacks, implement:
1. Timestamp validation: reject requests older than 5 minutes
2. Delivery ID tracking: store IDs and reject duplicates within window
3. Nonce validation for providers that support it

## Internal Network Protection

Callback URLs must be validated to prevent:
- Access to internal network addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- Access to cloud metadata endpoints (169.254.169.254, etc.)
- Access to localhost (127.0.0.1, ::1)