## Verdict

Request changes before this token migration reaches clients. The new paths make authentication central to schedule and admin access, but the verifier and refresh flow do not enforce the contracts in `docs/authentication.md`. The current tests establish only happy-path behavior, so the failures below can reach production without a regression signal.

## Findings

- **Critical — `src/middleware/bearer-auth.js:23`** The verifier takes `decoded.header.alg` as its algorithm and supplies a shared verification key to a helper that supports both HMAC and RSA. An attacker can label a token HS256 and sign it with the RSA public key, turning a public value into the HMAC secret and forging claims. Allowlist the expected algorithm and choose the verification key from server configuration, independently of the header.
- **Critical — `src/middleware/bearer-auth.js:38`** `exp` is a NumericDate in seconds, while `Date.now()` is milliseconds. `Date.now() <= payload.exp` is false for any real exp, so every token login issues (always with `expiresIn`) is rejected as expired and every client is locked out after the rollout. The PR's tests miss it because they sign without `expiresIn`. Compare in seconds: `Math.floor(Date.now() / 1000) <= payload.exp`.
- **High — `src/routes/session-routes.js:34`** The refresh handler accepts a valid refresh token repeatedly and creates a new pair without a server-side record, rotation, or revocation of the presented token. A stolen token can therefore be replayed until its long lifetime ends. Store a `jti`, rotate it on every refresh, and revoke the old single-use token.
- **High — `src/middleware/role-guard.js:4`** The guard authorizes from `claims.role`, although `UserStore.updateRole` can remove a user's admin role after the token is issued. Load the user from the user store and check the current role before allowing the admin route.
- **Medium — `src/middleware/bearer-auth.js:10`** The invalid-token response echoes the raw bearer credential. Remove the token from the 401 body and return only a generic error so response logging or client diagnostics cannot expose a reusable credential.
- **Low — `tests/bearer-auth.test.js:13`** The migration tests cover valid and missing headers but do not cover an expired token or a token whose signature was changed. Add negative cases for both and assert that each receives the 401 response.

```json
[
  { "location": "src/middleware/bearer-auth.js:23", "severity": "critical", "issue": "The verifier trusts the token header's algorithm while using a shared key, enabling an HS256 public-key forgery.", "fix": "Allowlist the algorithm and select the verification key independently of the header." },
  { "location": "src/middleware/bearer-auth.js:38", "severity": "critical", "issue": "Expiry seconds are compared with Date.now milliseconds, so every token that carries exp, which is every token login issues, is rejected as expired.", "fix": "Compare in seconds: divide Date.now() by 1000 before comparing with exp." },
  { "location": "src/routes/session-routes.js:34", "severity": "high", "issue": "Refresh accepts replayed tokens and does not rotate or revoke the presented token.", "fix": "Record a jti, rotate the refresh token, and revoke the old single-use token." },
  { "location": "src/middleware/role-guard.js:4", "severity": "high", "issue": "Admin access trusts the role claim instead of the user's current role in the store.", "fix": "Load the user from the user store and check the current role." },
  { "location": "src/middleware/bearer-auth.js:10", "severity": "medium", "issue": "The 401 body returns the raw bearer token.", "fix": "Remove the token and return a generic error." },
  { "location": "tests/bearer-auth.test.js:13", "severity": "low", "issue": "Tests omit expired and tampered-token rejection cases.", "fix": "Add expired and tampered negative cases." }
]
```