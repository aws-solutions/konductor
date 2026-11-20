# API notes

JSON responses have `content-type: application/json; charset=utf-8`. A successful list is an object with a `bookings` array. A successful create returns the booking and status 201.

## Booking export

`GET /api/v1/bookings/export` returns `text/csv; charset=utf-8`. The first row is the header `id,room,date,owner`. Fields containing a comma, double quote, or newline are enclosed in double quotes, and existing double quotes are doubled according to RFC 4180.

The optional `from` and `to` query parameters filter by booking date. Both bounds are inclusive. Each value must be an actual date in strict `YYYY-MM-DD` format, such as `2025-06-20`. An invalid or impossible value returns HTTP 400 with an error whose code is `bad_request`.

Errors have this shape:

```json
{ "error": { "code": "booking_not_found", "message": "Booking was not found" } }
```

The service does not persist writes. This is intentional for local development and the CI smoke test.
