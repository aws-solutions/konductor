# Incident summary: 2024-11-07 checkout delay

On 2024-11-07 from 14:03 to 14:19 UTC, the checkout API returned elevated 5xx responses in the us-east-1 production region. The incident began shortly after a partner promotion started and ended after traffic was reduced by the gateway's existing rate rule.

The service dashboard showed increased database write latency and a growing request queue. The order table's write queue reached its highest value at 14:11 UTC. Detail reads remained within their normal range. No order records were lost. The on-call replayed requests with unknown outcomes from the application queue after the database returned to normal latency.

The incident affected 4.1% of checkout attempts. Fulfillment processing and customer history remained available. The incident record lists the promotion start time, request counts, response latency, and the gateway rule change. The follow-up work is recorded in the service capacity planning document.
