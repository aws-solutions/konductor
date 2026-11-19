# Checkout latency decision

## Decision

Choose `parallelize-pricing-inventory`. Gateway and authentication remain on the request's serial path, while pricing and inventory start together after authentication. Payment remains on the request path after both results are available.

The measured hop p99 values are:

| Hop | p99 |
| --- | ---: |
| Gateway | 40 ms |
| Authentication | 60 ms |
| Pricing, live | 190 ms |
| Inventory | 150 ms |
| Payment | 280 ms |

With the selected execution, the estimated end-to-end p99 is `40 + 60 + max(190, 150) + 280 = 570 ms`. This is within the 600 ms production target. The arithmetic is a planning estimate, so the rollout should verify the resulting end-to-end p99 in production telemetry.

## Options and tradeoff

Keeping the current serial flow costs no new recurring service, but its estimate is `40 + 60 + 190 + 150 + 280 = 720 ms`, which misses the latency target. The selected parallel flow uses the existing platform allocation and has 1,500 requests/second of regional capacity, so it clears the 1,200 requests/second peak without adding monthly service spend.

The cache alternative lowers pricing p99 from 190 ms to 40 ms. Combined with parallel execution, its estimate would be `40 + 60 + max(40, 150) + 280 = 530 ms`, but the cache costs 800 USD/month in addition to the 420 USD/month checkout platform allocation. Its 1,220 USD/month total is above the 1,000 USD/month cap, so the extra latency margin is not worth selecting under this budget.

The selected option keeps the largest current checkout request at 96 KB against the 256 KB limit. Its recovery values are a 30-second RPO and a 4-minute RTO, within the 60-second and 5-minute requirements.

```decision
{"chosen":"parallelize-pricing-inventory","options":["keep-serial","parallelize-pricing-inventory","cache-pricing-and-parallelize"],"limits":{"end_to_end_p99_ms":{"limit":600,"value":570},"throughput_rps":{"limit":1200,"value":1500},"monthly_cost_usd":{"limit":1000,"value":420},"payload_kb":{"limit":256,"value":96},"rpo_seconds":{"limit":60,"value":30},"rto_minutes":{"limit":5,"value":4}},"monthly_cost_usd":420}
```