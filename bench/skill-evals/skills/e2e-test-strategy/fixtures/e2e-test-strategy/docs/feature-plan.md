# Feature Plan: Release 2.4.1

Security fix: password reset links could be reused after a successful reset (token was not invalidated on use) and the
30-minute expiry was compared against the server's local time instead of UTC. Fix invalidates the token on first use and
compares in UTC. No other features ship in this patch.
