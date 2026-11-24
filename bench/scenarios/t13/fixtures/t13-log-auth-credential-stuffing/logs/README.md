# Gateway log field guide

Each JSON line has `ts`, `node`, `event`, `account`, `src_ip`, `ua`, and `reason`. The event values are `login_attempt`, `login_ok`, `login_fail`, `mfa_challenge`, `mfa_ok`, and `token_issued`.

`ts` is an ISO 8601 timestamp. Gateway node `gw-a` records UTC. Node `gw-b` records local time (UTC-5) because of a known configuration bug tracked in `OPS-1842`; convert it before comparing nodes.

A failed login is an unsuccessful credential check. A successful login does not by itself prove that a usable session was made; inspect the subsequent challenge and token events.
