# Add refresh-token rotation and remember-me sessions

This pull request adds refresh cookies, replaces the session credentials during refresh, and lets a person keep a longer-lived browser session when they select remember me. It also routes reset requests through the same account service and makes the HTTP adapter carry per-cookie options.

The goal is to make returning users stop typing their password while keeping the existing session limits, expiry behavior, and reset flow. The old login and logout paths remain available, and the browser receives the replacement cookies after a successful refresh.

I tested this with `node --test` and `npm run check`. The new tests cover refresh responses, the remember-me option, session records, and the refresh token shape. The existing account, password, logout, and reset tests continue to pass.
