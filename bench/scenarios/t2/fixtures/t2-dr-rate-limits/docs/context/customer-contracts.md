# Customer Contract Specifications

## Rate Limit Definitions

All rate limits in customer contracts are defined as **maximum requests per rolling 60-second window**. The contractual language specifies:

> "Customer shall not exceed [X] requests in any 60-second period, measured as a rolling window."

## Enterprise Customer Specifics

### Acme Corp (Contract AC-2024-001)
- **Base limit**: 50,000 requests per minute
- **Burst allowance**: 20% above limit for up to 5 minutes
- **Peak hours adjustment**: 75,000 requests/minute (9 AM - 5 PM EST)
- **Reporting requirement**: Real-time alerts at 80% of limit

### Globex Industries (Contract GI-2023-045)
- **Base limit**: 30,000 requests per minute  
- **Geographic distribution**: 15,000/minute per region (US, EU, APAC)
- **Compliance requirement**: Per-endpoint limits for regulatory APIs

### Initech Solutions (Contract IS-2024-012)
- **Base limit**: 25,000 requests per minute
- **Department breakdown**: Limits per business unit (Sales: 40%, Engineering: 40%, Support: 20%)
- **Carry-over**: Unused capacity up to 10% can carry to next hour

## Contractual Obligations

### Uptime Guarantees
- **Rate limiting service**: 99.99% availability
- **Data consistency**: 99.9% of rate limit decisions must be consistent across all servers
- **Latency**: Rate limit check adds ≤ 5 ms p99 to API response time

### Failure Scenarios
Contracts specify that during infrastructure failures:
- **Critical APIs**: Must continue operating with degraded rate limiting
- **Non-critical APIs**: May be rate limited more aggressively
- **Reporting**: All rate limit decisions must be logged for post-incident analysis

### Billing Implications
- **Overages**: 150% of base rate for requests over limit
- **Disputes**: Customer can dispute charges if rate limiting was incorrectly applied
- **Credits**: Service credits issued for rate limiting errors causing business impact

## SLA Penalties

| Availability Level | Credit |
|-------------------|--------|
| 99.9% - 99.99% | 10% monthly fee |
| 99.0% - 99.9% | 25% monthly fee |
| < 99.0% | 50% monthly fee |

Rate limiting is considered "unavailable" when:
1. More than 0.1% of requests receive incorrect rate limit decisions
2. Rate limiting adds > 10 ms p99 latency for more than 5 minutes
3. Counter store is unreachable for > 30 seconds