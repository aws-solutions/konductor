# Latency Optimization Decision

## Current State Analysis

Based on the traffic analysis documentation, the current sequential service latencies (p99) are:

- API Gateway: 40 ms
- Authentication Service: 60 ms  
- Pricing Service: 190 ms
- Inventory Service: 150 ms
- Payment Service: 280 ms

**Total sequential latency**: 40 + 60 + 190 + 150 + 280 = 720 ms

This exceeds the target p99 latency of ≤ 600 ms specified in the requirements.

## Optimization Options Considered

### Option 1: Base (Current Configuration)
- **Cost**: $0/month
- **Latency**: 720 ms sequential
- **Analysis**: Does not meet 600 ms requirement

### Option 2: Parallel Processing Only
- **Cost**: $0/month (from cost sheet)
- **Latency**: Gateway(40) + Auth(60) + max(Pricing(190), Inventory(150)) + Payment(280) = 40 + 60 + 190 + 280 = 570 ms
- **Analysis**: Meets 600 ms requirement, zero additional cost

### Option 3: Pricing Cache Only  
- **Cost**: $900/month ($800 cache + $100 maintenance)
- **Latency**: With cached pricing at 40 ms: 40 + 60 + 40 + 150 + 280 = 570 ms (sequential)
- **Analysis**: Meets latency requirement but expensive at $900/month

### Option 4: Cache + Parallel Processing
- **Cost**: $900/month ($800 cache + $100 maintenance)
- **Latency**: Gateway(40) + Auth(60) + max(CachedPricing(40), Inventory(150)) + Payment(280) = 40 + 60 + 150 + 280 = 530 ms
- **Analysis**: Best latency (530 ms) but same cost as cache-only

## Budget Analysis

**Monthly budget ceiling**: $1,000 (from requirements.md)
**Current baseline cost**: $900 (from cost-analysis.md)
**Available for optimizations**: $100 (within $1,000 ceiling)

- **Parallel only**: $0/month → Fits within $100 budget ($900 total)
- **Cache options**: $900/month → Exceeds $1,000 ceiling ($1,800 total)

## Recommendation

**Selected Option**: Parallel processing only (option "parallel")

**Reasoning**:
1. **Meets latency requirement**: 570 ms p99 < 600 ms target
2. **Fits within budget**: $0 additional cost keeps total at $900/month, well under $1,000 ceiling
3. **Cost-effective**: Achieves requirement without any additional infrastructure cost
4. **Simpler implementation**: Less complexity than cache solution

The parallel processing approach leverages the architectural insight that pricing and inventory services have no data dependency and can run concurrently. This reduces the combined latency of these two services from 340 ms (190 + 150) to 190 ms (max of both).

```decision
{
  "chosen": "parallel",
  "options": ["base", "parallel", "cache", "cache_parallel"],
  "limits": {
    "p99_latency_ms": {
      "limit": 600,
      "value": 570
    },
    "monthly_budget_usd": {
      "limit": 1000,
      "value": 900
    }
  },
  "monthly_cost_usd": 0
}
```

## Implementation Notes

The parallel processing implementation requires:
1. Modifying the service orchestrator to invoke pricing and inventory concurrently
2. Adding a synchronization point before the payment service
3. Implementing timeout handling (suggest 250 ms max wait for both services)
4. Updating error handling for partial failures

This change is estimated to take 2 weeks of development effort as noted in the implementation notes.