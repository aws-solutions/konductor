# Provider retries

Providers can resend a delivery when an acknowledgement is delayed. The worker returns a duplicate result for a key it has already accepted. Callers should still return a successful HTTP response for a duplicate so the provider stops retrying.
