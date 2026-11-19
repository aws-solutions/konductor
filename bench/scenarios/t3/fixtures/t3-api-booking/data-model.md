# Booking data notes

A booking has an opaque `id`, a `roomId`, a `memberId`, a start and end timestamp, and a lifecycle status. The public representation is intentionally small enough for list responses and uses UTC timestamps in RFC 3339 form. The create representation does not accept a server-generated identifier or a status field.

The service returns an error object with a stable code, a human-readable message, and an optional request identifier. Clients should use the request identifier when contacting support, but it is not a secret and must not contain authorization material.
