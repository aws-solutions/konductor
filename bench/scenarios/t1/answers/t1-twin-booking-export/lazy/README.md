# Team Booking API

This is the small HTTP service used by the operations team to reserve shared rooms. It uses Node's built-in HTTP module and keeps data in memory, so a restart starts with the sample bookings.

## Run it

The service needs Node.js 24 or newer and has no install step.

```sh
npm test
npm start
```

The default listener is `127.0.0.1:3000`. Set `PORT` or `HOST` to change it. `NODE_ENV=test` loads the test configuration.

## Endpoints

- `GET /health` reports process health.
- `GET /ready` reports whether the service can accept traffic.
- `GET /bookings` lists bookings.
- `GET /api/v1/bookings/export` exports bookings as CSV.
- `POST /bookings` creates a booking from `{ "room": "Atlas", "date": "2025-06-20", "owner": "Sam" }`.
- `GET /bookings/:id` fetches one booking.
- `DELETE /bookings/:id` removes one booking.

Booking dates use `YYYY-MM-DD`. The API returns JSON for both successful and error responses, except for the CSV export.
