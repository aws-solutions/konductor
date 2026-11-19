# Latency Budget Analysis

## Overall API Latency Budget

| Component | Budget (p99) | Current (p99) | Notes |
|-----------|--------------|---------------|-------|
| Load balancer | 2 ms | 1.5 ms | AWS ALB |
| API routing | 5 ms | 4.2 ms | API Gateway |
| Authentication | 15 ms | 12 ms | JWT validation |
| **Rate limiting** | **5 ms** | **N/A** | **New component** |
| Business logic | 60 ms | 55 ms | Application code |
| Database | 10 ms | 8 ms | PostgreSQL |
| Response serialization | 3 ms | 2.5 ms | JSON encoding |
| **Total** | **100 ms** | **78 ms** | **Current baseline** |

## Rate Limiting Latency Breakdown

### Target: 5 ms p99 total

| Sub-component | Target | Notes |
|---------------|--------|-------|
| Customer ID extraction | 0.5 ms | From JWT or API key |
| Redis GET operation | 2.0 ms | Current Redis p99 |
| Business logic | 0.5 ms | Limit calculation |
| Redis INCR operation | 2.0 ms | If under limit |
| **Total** | **5.0 ms** | **Maximum allowed** |

### Current Measurements (Test Environment)

| Operation | p50 | p95 | p99 | p99.9 |
|-----------|-----|-----|-----|-------|
| Redis GET (local) | 0.8 ms | 1.2 ms | 1.8 ms | 3.5 ms |
| Redis GET (cross-AZ) | 1.2 ms | 2.1 ms | 3.5 ms | 8.0 ms |
| Redis INCR (local) | 0.9 ms | 1.3 ms | 2.0 ms | 4.0 ms |
| Network round trip | 0.5 ms | 1.0 ms | 2.0 ms | 5.0 ms |

## Critical Path Analysis

The rate limiting check sits on the **critical path** of every API request. Any added latency directly impacts customer experience and SLAs.

### Impact Scenarios

1. **Best case** (local Redis): ~1.7 ms added latency
2. **Typical case** (cross-AZ): ~3.7 ms added latency  
3. **Worst case** (network issues): Could exceed 10 ms

### Network Considerations

- API servers distributed across 3 availability zones
- Redis cluster in 2 AZs (primary), 1 AZ (secondary)
- Cross-AZ latency: 1-2 ms typical, 5 ms p99
- Inter-region latency: 50-100 ms (failover scenario)

## Performance Testing Results

### Load Test (10x production traffic)

| Metric | Result | Pass/Fail |
|--------|--------|-----------|
| Rate limit check latency p99 | 4.8 ms | **PASS** |
| Total API latency p99 | 83.2 ms | **PASS** |
| Redis ops/sec | 480,000 | **PASS** |
| Error rate | 0.05% | **PASS** |

### Failover Test

| Scenario | Impact | Duration |
|----------|--------|----------|
| Redis master failure | 2s timeout | 2-5 seconds |
| Network partition | Fallback to local cache | Until resolved |
| Region outage | Failover to secondary | 30-60 seconds |

## Optimization Opportunities

1. **Pipeline Redis operations**: GET and INCR could be pipelined
2. **Local cache**: Cache rate limit decisions for 100ms
3. **Connection pooling**: Reuse Redis connections
4. **Batching**: Batch updates for high-volume customers