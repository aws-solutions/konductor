# Trailhead HTTP API

All endpoints use JSON and are rooted at `/v1`. Clients should send an `Accept: application/json` header.

## List issues

`GET /v1/issues`

The endpoint accepts `status`, `assignee`, `limit`, and `cursor` query parameters. `limit` is a positive integer and defaults to 20. A cursor from the previous response continues the list.

The response has this shape:

```json
{
  "data": [{ "id": "ISS-1001", "title": "..." }],
  "page": { "nextCursor": "..." }
}
```

`nextCursor` is omitted on the final page. New clients should pass it back unchanged to request the next page.

## Get an issue

`GET /v1/issues/:id`

Returns one issue or a `404` error object.

## Comments

`GET /v1/issues/:id/comments` returns comments ordered from oldest to newest. `POST /v1/issues/:id/comments` accepts `{ "body": "text" }` and returns `201`.

## Users

`GET /v1/users` returns users ordered by display name. `GET /v1/users/:id` returns one user.

## Compatibility

The `/v1` response names are stable. A breaking response-shape change must use a new major path such as `/v2` or an explicitly negotiated media type. Existing `/v1` clients must continue to receive the documented top-level fields during the deprecation window.

Errors use `{ "error": { "code": "...", "message": "..." } }`. No endpoint returns stack traces.
