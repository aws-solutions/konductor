## Review

I would not merge this pull request yet. The session changes add several authentication credentials and recovery paths, but the implementation leaves replayable credentials behind and weakens the documented revocation and transport guarantees. The reset-token source is also unsafe for an account-recovery secret.

The most urgent fixes are to make refresh rotation genuinely single-use and to generate reset tokens with cryptographic randomness. The cookie and session-lifecycle issues then need to be fixed together so a user who logs out or changes a password cannot keep an older credential alive. The refresh lookup should use the existing constant-time comparison helper rather than a direct equality check.

- `src/session-store.js:53` creates a second record without revoking the record that held the presented refresh token. Replaying the old token therefore creates another valid session after rotation. Revoke or consume the old record before storing the replacement so refresh tokens remain single-use.
- `src/session-store.js:48` compares a supplied refresh token with `===`. Use the token digest and a constant-time comparison, such as the existing timing-safe helper, for this credential lookup.
- `src/routes/auth-routes.js:20` gives the remember-me cookie only a Max-Age. Include the HttpOnly and Secure cookie flags, in addition to its lifetime, before sending this persistent credential.
- `src/reset-service.js:16` builds the password-reset secret with Math.random. Generate it with crypto.randomBytes or another cryptographic random source so the reset token is not predictable.
- `src/account-service.js:34` changes the password without invalidating the account's active sessions. Call revokeAllForAccount after a successful change so the behavior matches the session policy and forces every device to authenticate again.
- `src/routes/auth-routes.js:45` only asks the browser to discard cookies. Look up the current server session and call sessions.revoke before returning so a copied session credential stops working at logout.

```json
[
  {
    "location": "src/session-store.js:53",
    "severity": "high",
    "issue": "The replacement record is appended while the old refresh-token record stays active, so a stolen refresh token can be replayed after rotation.",
    "fix": "Revoke or consume the old record before storing the replacement so refresh tokens are single-use."
  },
  {
    "location": "src/session-store.js:48",
    "severity": "medium",
    "issue": "Refresh-token lookup uses plain string equality instead of a constant-time comparison for an attacker-controlled credential.",
    "fix": "Compare token digests with the existing timing-safe helper."
  },
  {
    "location": "src/routes/auth-routes.js:20",
    "severity": "high",
    "issue": "The remember-me cookie lacks HttpOnly and Secure flags, exposing a persistent credential to script access and insecure transport.",
    "fix": "Set the HttpOnly and Secure cookie flags for the remember-me cookie."
  },
  {
    "location": "src/reset-service.js:16",
    "severity": "critical",
    "issue": "Password-reset tokens are generated with Math.random and can be predictable.",
    "fix": "Use crypto.randomBytes for cryptographic randomness."
  },
  {
    "location": "src/account-service.js:34",
    "severity": "high",
    "issue": "A password change updates the password but leaves existing sessions active, contrary to the session policy.",
    "fix": "Call revokeAllForAccount to invalidate all sessions after the password changes."
  },
  {
    "location": "src/routes/auth-routes.js:45",
    "severity": "medium",
    "issue": "Logout clears browser cookies but leaves the server-side session active, so a copied session cookie still works.",
    "fix": "Revoke the server session with sessions.revoke before clearing the cookies."
  }
]
```