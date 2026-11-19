# API contract

Responses use JSON with an `error` string for failures. `GET /health` is public.

## Schedule

`GET /schedule?date=YYYY-MM-DD` returns the shifts visible to the caller. `POST /admin/shifts` adds a shift and returns 201.

## Admin

`GET /admin/users` returns active users. Both administration endpoints require the `admin` role.
