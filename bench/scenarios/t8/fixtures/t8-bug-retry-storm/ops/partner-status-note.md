# Partner service note

Issued 2025-03-18 05:25 UTC by the Northstar partner operations desk.

The order endpoint had elevated latency and intermittent `429` and `503` responses from 02:12 UTC through 03:06 UTC. The partner asked clients to use the `Retry-After` response header and to spread repeat requests. Health probes and read-only endpoints were mostly normal. The partner completed capacity work at 03:11 UTC.
