# Session policy

This service treats a browser session as a server-side record, not just a cookie.

- An idle session expires after 1,800 seconds.
- The absolute session lifetime is 2,592,000 seconds.
- Refresh tokens are single-use credentials. A successful refresh replaces the stored token; the previous token must not work again.
- A logout expires the browser cookies and revokes the matching server session.
- A password change revokes every session belonging to the account. The account owner must sign in again on every device.
- Password reset links are single-use and expire after 1,200 seconds.
- At most five active sessions are retained for an account.

The session cookie is scoped to `/`, uses `SameSite=Lax`, and is marked `HttpOnly` and `Secure` when sent over HTTPS. Refresh cookies have the same transport protections.
