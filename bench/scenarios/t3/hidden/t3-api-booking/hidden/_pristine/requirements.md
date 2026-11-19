# Public contract requirements

## User-visible behavior

The public API must let a client list bookings for a room between two timestamps, fetch one booking, and create a booking. A create request is retried by clients after network failures, so it carries a required idempotency key. A list response must expose a way to continue reading results and must make its page-size ceiling explicit.

## Current gateway envelope

The production gateway rejects a response body larger than **1,048,576 bytes (1 MiB)**. This limit applies to the serialized HTTP body returned by the public endpoint. An older partner guide says `max page size 500`; that guide applies to the gateway generation retired last year and is superseded by the current envelope above.

The list endpoint has a production p95 latency objective of **350 ms**. The gateway and service tier must sustain at least **240 requests per second** at the production peak. These are service-selection limits, not client hints.

The current production envelope is summarized here for the API review:

| Concern | Production constraint | Measurement |
| --- | ---: | --- |
| Serialized response body | 1,048,576 bytes | gateway rejection threshold |
| List p95 latency | 350 ms maximum | room/date-range request |
| Monthly API spend | 500 USD maximum | current request mix |

## Delivery guardrails

The architecture estimate must stay under the production monthly API budget of **500 USD**. The estimates use the request volumes in `traffic.json` and the current rates in `prices.json`. Round currency to cents in the decision record.

The public contract should use ISO 8601 timestamps, stable identifiers, and machine-readable errors. It should not expose internal database columns or credentials.
