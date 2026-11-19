# Catalogue database runbook

The primary accepts at most 240 connections. Read traffic normally goes to read-1. The pool has a bounded wait and the API should return a dependency error rather than hold a request forever.

Useful checks:

```sh
python3 scripts/check-replica.py --host read-1
```

Review CPU, active connections, waiters, and replication lag together. A completed reporting query can raise CPU without exhausting the page pool; compare its time and query class with API errors before changing database limits.

After traffic returns to normal, verify that waiters are zero and that replica lag is declining. Do not raise the connection ceiling as the first response to a cache or application traffic burst.
