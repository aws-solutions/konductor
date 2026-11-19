# Webhook contract

Every accepted event has an `id`, `provider`, `kind`, and `receivedAt` value.
The payload is JSON and unknown fields are retained for forwarding. A malformed
body receives a 400 response; a valid envelope that cannot be processed gets a
202 response so the provider can stop retrying.

The notification body contains the normalized event and the original delivery
identifier. Customers may configure the destination in their tenant settings.
The generic receiver supports both source-control and billing provider paths.

A normalized event uses the provider's delivery identifier when one is present
in the payload or request envelope. Event kinds are retained as sent by the
provider, with a provider default for older payloads.
