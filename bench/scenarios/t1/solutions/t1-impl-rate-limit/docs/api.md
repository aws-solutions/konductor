# API notes

All responses have `content-type: application/json; charset=utf-8`. A successful list is an object with a `bookings` array. A successful create returns the booking and status 201.

Booking routes require an API key in `x-api-key` or `x-booking-api-key`. The first header wins when both are supplied. `GET /health` and `GET /ready` do not require a key.

Errors have this shape:

```json
{ "error": { "code": "booking_not_found", "message": "Booking was not found" } }
```

The service does not persist writes. This is intentional for local development and the CI smoke test.
