# Search incident summary: campaign launch

**Date:** 2024-11-22
**Duration:** 27 minutes
**Affected path:** storefront catalogue search

At 09:03 UTC, a campaign email sent a large group of shoppers to the books landing page. Search traffic rose from 190 requests per second to 640 requests per second. PostgreSQL read replicas reached their connection limit at 09:06 UTC. Search p95 rose from 210 ms to 1.8 seconds, and the API returned HTTP 504 for 3.6% of requests between 09:07 and 09:19 UTC.

The platform team reduced the campaign query fan-out and increased the read pool. Traffic returned below 250 requests per second at 09:30 UTC. No product, price, or stock records were changed. The incident was closed after the API error rate and p95 returned to their normal ranges.

The incident timeline records request volume, database connections, and API latency. It does not include search-result relevance measurements because the existing dashboard did not collect them.
