# Authentication

The API accepts bearer tokens issued by the login and refresh endpoints. The legacy cookie session has been removed from the route layer so mobile and desktop clients share the same contract.

## Token claims

Access tokens contain `sub`, `role`, `iat`, and `exp`. The `exp` claim is a NumericDate, measured in seconds since the Unix epoch. Access tokens use the configured `accessLifetimeSeconds` value and should be short lived.

Refresh tokens are intended for the refresh endpoint only. A refresh token is single-use: the server records its identifier, rotates it when issuing a new pair, and revokes the old identifier. A user who is disabled or whose role changes must not keep access through an old token.

Clients send the token as `Authorization: Bearer <token>`. Invalid credentials receive a 401 response without token material in the response body. A 403 response means the caller is authenticated but lacks the current permission.

## Local testing

The test secret is `test_key_123`. It is only fixture data and must not be used in a deployed environment. The test suite exercises login, refresh, and rejected credentials without requiring a network listener.
