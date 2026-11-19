# Catalogue on-call notes

Primary service owner: Maya Chen. Database owner: Ravi Mehta. Release coordinator: Nora Ives.

The catalogue API is expected to return a product page in under 300 ms at the p95. Cache hit ratio is normally above 0.88. The read replica may lag briefly during a bulk index update, but the page path should fail over to a bounded response rather than wait indefinitely.

During a page error event, compare the API request rate with the cache hit ratio, database active connections, and replica lag. Record UTC timestamps from the original files when handing off. The database connection ceiling is 240 and the normal pool waiters count is zero.

Escalate to the database owner if connection waiters remain above 100 for two minutes. Escalate to the release coordinator for a configuration or policy change.
