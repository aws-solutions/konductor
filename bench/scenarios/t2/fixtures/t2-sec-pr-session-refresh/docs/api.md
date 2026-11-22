# Account API

The examples below show the shape used by the HTTP adapter. Error responses use `{ "error": "message" }` and do not expose whether a password was close to matching.

## Login

`POST /login`

```json
{ "email": "alex@example.test", "password": "correct horse", "rememberMe": false }
```

A successful response sets the session and refresh cookies and returns `{ "account": { "id": "acct_1" } }`.

## Refresh

`POST /refresh` reads the refresh cookie. It returns a new session cookie and a new refresh cookie when the refresh session is usable. Expired or unknown refresh cookies receive `401`.

## Logout

`POST /logout` has no body. It expires the browser cookies and ends the server-side session associated with the request.

## Password changes

`POST /password` requires the current session and accepts `{ "currentPassword": "...", "newPassword": "..." }`. After a successful change, all sessions for the account are ended and the client must sign in again.

## Password reset

`POST /password-reset/request` accepts `{ "email": "..." }`. It returns the same response for known and unknown addresses. The service sends a link containing a single-use token that expires after the configured reset period.
