# Realtime collaboration SLO notes

The customer-facing availability objective is 99.95% for room operations. The websocket connection objective is 99.9% successful connection establishment per 28-day window.

Sessions are long lived. The p95 drain time is **40 minutes** after a host stops accepting new websocket connections; the p99 is 47 minutes. A release must preserve existing sessions while it moves new sessions away from a host.

The session router retries an upstream connection twice with jitter. The presence service is allowed to lag for 30 seconds before its alert fires.
