# Add generic webhook handler

## What
Adds a generic webhook handler that can receive webhooks from any provider with signature verification. The handler validates HMAC signatures, tracks delivery IDs to prevent replays, and can forward payloads to customer-configured callback URLs.

## Why
Customers have been asking for support for custom webhook providers beyond GitHub and Stripe. This generic handler lets them integrate any service that uses HMAC signatures. It's more flexible than provider-specific handlers and reduces code duplication.

## Changes
- New `src/handlers/generic.js` with signature verification, delivery ID tracking, and callback forwarding
- New `src/config/security.js` with security constants and configuration
- Updated `src/index.js` to add the `/webhooks/generic` route and improve logging
- Added tests for the new handler

## Testing
- Unit tests for signature verification, delivery ID tracking, and URL validation
- Manual testing with curl commands simulating various providers
- Verified callback forwarding works with external test endpoints
- All existing tests still pass

## Security Considerations
- Uses HMAC-SHA256 for signature verification
- Tracks delivery IDs in memory (will need Redis in production)
- Validates callback URLs to prevent internal network access
- Falls back to default secret if env var not set for local development

Ready for review! This should unblock several customer integrations.