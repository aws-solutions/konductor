# API Rate Limiting Design

**Document ID**: API-RL-2024-03-15  
**Version**: 1.1  
**Status**: Review  
**Authors**: Platform Engineering Team  
**Reviewers**: Security, SRE, Product  

## 1. Overview

This document outlines the design for implementing per-customer rate limiting across our fleet of stateless API servers. The system will enforce usage limits according to customer contracts, ensuring fair resource allocation and protecting our infrastructure from abusive traffic patterns.

### 1.1 Context

Our API service handles approximately 2.3 million requests per minute across 150+ microservices. The current rate limiting implementation uses local in-memory counters per server instance, which leads to inconsistent enforcement and violates contractual obligations with enterprise customers.

### 1.2 Goals

- Enforce per-customer request limits consistently across all API servers
- Support multiple customer tiers with different rate limits
- Maintain sub-5ms p99 latency for rate limit checks
- Ensure high availability (99.99% uptime for rate limiting service)
- Provide detailed usage reporting for billing and analytics

## 2. Architecture

### 2.1 System Components

```
┌─────────────┐    ┌──────────────┐    ┌──────────────┐
│   API       │    │   Rate       │    │   Counter    │
│   Servers   │───▶│   Limiter    │───▶│   Store      │
│   (150+)    │    │   Middleware │    │   (Redis)    │
└─────────────┘    └──────────────┘    └──────────────┘
                         │
                         ▼
                  ┌──────────────┐
                  │   Alerting   │
                  │   & Metrics  │
                  └──────────────┘
```

### 2.2 Data Flow

1. Request arrives at any API server
2. Rate limiter middleware extracts customer ID from API key or JWT
3. Middleware queries counter store for current window count
4. If under limit, increment and allow request
5. If over limit, return 429 Too Many Requests
6. Log decision for analytics and billing

## 3. Implementation Details

### 3.1 Rate Limiting Algorithm

We will use a **fixed window counter** algorithm for simplicity and performance:

```python
def check_rate_limit(customer_id, window_seconds=60):
    window_key = f"rate_limit:{customer_id}:{int(time.time() / window_seconds)}"
    current = counter_store.get(window_key) or 0
    
    if current >= get_limit_for_customer(customer_id):
        return False  # Over limit
    
    counter_store.incr(window_key)
    return True  # Under limit
```

**Window size**: 60 seconds for all customers  
**Counter precision**: Single increment per request  
**Key format**: `rate_limit:{customer_id}:{window_number}`

### 3.2 Counter Store Selection

After evaluating several options, we selected **Redis Cluster** as our counter store:

- **Primary Redis cluster**: 6 nodes (3 master, 3 replica) in us-east-1
- **Secondary cluster**: 6 nodes in us-west-2 for disaster recovery
- **Data persistence**: RDB snapshots every 15 minutes
- **Maximum throughput**: 500,000 operations per second
- **Latency**: < 2ms p99 for GET/INCR operations

The Redis clusters are managed by our cloud provider with automatic failover. During failover, writes may be blocked for up to 2 seconds while a new master is elected.

### 3.3 Customer Tiers and Limits

| Tier | Requests/Minute | Monthly Cost | Features |
|------|----------------|--------------|----------|
| Free | 1,000 | $0 | Basic API access |
| Pro | 10,000 | $99/month | Higher limits, priority support |
| Business | 100,000 | $499/month | SLA, dedicated support |
| Enterprise | Custom | Negotiated | Custom limits, 24/7 support |

All limits are enforced per minute windows. Enterprise customers will have custom limits defined in their contracts.

### 3.4 Failure Handling

The rate limiter must handle failures gracefully:

1. **Counter store unavailable**: Rate limiting will be temporarily disabled to avoid blocking legitimate traffic. We will log warnings and continue processing requests.
2. **Network timeouts**: After 100ms timeout, treat as counter store unavailable.
3. **Invalid customer data**: Default to Free tier limits.

This approach ensures we never block customers due to infrastructure issues.

### 3.5 Performance Considerations

Each rate limit check requires:
- 1 Redis GET operation (current count)
- 1 Redis INCR operation (if under limit)
- Total: 2 network round trips

Given our Redis cluster latency of < 2ms p99, the total added latency should be under 5ms p99.

### 3.6 Monitoring and Alerting

We will monitor:
- Rate limit decision counts (allow/deny) per tier
- Counter store latency and error rates
- Cache hit/miss ratios
- Customer-specific limit violations

Alerts will trigger when:
- Counter store error rate exceeds 1% for 5 minutes
- Rate limiting disabled for more than 1 minute
- Any customer exceeds 200% of their limit in a window

### 3.7 Deployment Strategy

**Phase 1**: Deploy to staging environment with 10% traffic for 1 week  
**Phase 2**: Gradual rollout to production, starting with Free tier customers  
**Phase 3**: Full deployment to all customers over 4 weeks  

### 3.8 Testing Plan

1. **Unit tests**: Rate limit logic and error handling
2. **Integration tests**: Full flow with mock Redis
3. **Load tests**: Simulate 5x production traffic
4. **Failover tests**: Redis cluster failover scenarios
5. **Chaos engineering**: Network partitions, latency spikes

### 3.9 Security Considerations

- Rate limit counters must not leak customer usage patterns
- API keys must be validated before rate limiting
- DoS protection for rate limit endpoint itself
- Audit logs for all rate limit changes

### 3.10 Client Integration

API clients will receive standard HTTP 429 responses with `Retry-After` headers indicating when to retry. Our SDK documentation specifies that clients should implement exponential backoff when receiving 429 responses.

The rate limiting middleware will integrate with our existing API gateway to extract customer identifiers from various authentication methods:

1. **API Key Authentication**: Extract customer ID from API key prefix and validate against key service
2. **JWT Tokens**: Parse JWT claims to obtain customer ID and tier information
3. **OAuth 2.0**: Use OAuth token introspection to identify customer
4. **Session Tokens**: For web applications using session-based authentication

#### Response Format

When a request exceeds rate limits, the client will receive:

```json
{
  "error": "rate_limit_exceeded",
  "message": "Rate limit exceeded for customer",
  "limit": 1000,
  "remaining": 0,
  "reset": 1617235200
}
```

The HTTP status code will be 429 (Too Many Requests). We will include standard rate limit headers where appropriate.

#### SDK Compatibility

Our SDKs for Python, JavaScript, Java, and Go will automatically handle rate limiting responses by:
1. Parsing `Retry-After` headers for wait times
2. Implementing exponential backoff with jitter
3. Providing hooks for custom rate limit handling
4. Exposing rate limit usage metrics to applications

#### Migration Strategy

Existing clients will need to update their SDK versions to get automatic rate limit handling. During the migration period:
1. Old SDKs will receive 429 responses but may not handle them optimally
2. We will provide migration guides and code samples
3. Critical customers will receive dedicated support during transition
4. Monitoring will track 429 response rates by SDK version

#### Testing Client Integration

We will provide:
1. Mock API server for testing rate limit scenarios
2. Integration test suites for all SDKs
3. Load testing tools to verify client backoff behavior
4. Documentation with common integration patterns

### 3.11 Cost Analysis

Implementing this rate limiting system has both direct and indirect costs:

#### Infrastructure Costs
- **Redis Clusters**: $3,500/month (primary + secondary)
- **Network traffic**: $800/month (estimated cross-AZ data transfer)
- **Monitoring**: $1,200/month (additional metrics and alerts)
- **Total monthly**: $5,500

#### Development Costs
- **Engineering effort**: 12 person-weeks for implementation
- **Testing effort**: 4 person-weeks for integration testing
- **Documentation**: 2 person-weeks for API and SDK updates
- **Total engineering**: 18 person-weeks

#### Operational Costs
- **On-call rotation**: Additional SRE coverage for rate limiting service
- **Incident response**: Training for rate limiting-specific incidents
- **Customer support**: Training support team on rate limit issues
- **Compliance**: Audit and reporting for contract compliance

#### Cost Savings
- **Reduced infrastructure**: More efficient resource usage with proper rate limiting
- **SLA compliance**: Avoidance of penalties for rate limiting failures
- **Customer satisfaction**: Better experience leading to retention
- **Operational efficiency**: Reduced manual intervention for rate limit issues

### 3.12 Risk Assessment

#### Technical Risks
1. **Redis dependency**: Single point of failure for entire API platform
2. **Latency impact**: Could exceed budgets under load or network issues
3. **Clock skew**: Inconsistent rate limiting across servers
4. **Scalability limits**: Redis cluster may not scale to projected growth
5. **Data consistency**: Replication lag could cause inconsistent decisions

#### Business Risks
1. **Customer impact**: False positives could block legitimate traffic
2. **Contract violations**: Incorrect rate limiting could breach SLAs
3. **Revenue impact**: Overly aggressive rate limiting could reduce API usage
4. **Competitive disadvantage**: Poor rate limiting experience vs competitors
5. **Legal exposure**: Contract disputes over rate limit enforcement

#### Mitigation Strategies
1. **Circuit breakers**: Fail open during Redis failures to avoid blocking all traffic
2. **Performance testing**: Extensive load testing before production deployment
3. **Monitoring**: Comprehensive metrics and alerting for early detection
4. **Rollback plan**: Ability to quickly revert to old rate limiting if needed
5. **Phased rollout**: Start with non-critical customers and expand gradually

### 3.13 Alternative Approaches Considered

We evaluated several alternative approaches before selecting the Redis-based design:

#### Local Counters with Synchronization
- **Approach**: Each server maintains local counters, periodically synced to central store
- **Pros**: Better latency, less dependency on central store
- **Cons**: Inconsistent enforcement during sync periods, complex synchronization logic
- **Decision**: Rejected due to consistency requirements

#### Token Bucket Algorithm
- **Approach**: Tokens added at fixed rate, requests consume tokens
- **Pros**: Smooths traffic bursts, more predictable behavior
- **Cons**: More complex implementation, stateful across requests
- **Decision**: Considered but rejected due to implementation complexity

#### Sliding Window Logs
- **Approach**: Maintain log of request timestamps, count within sliding window
- **Pros**: Accurate rolling window enforcement
- **Cons**: High memory usage, expensive to compute for high volumes
- **Decision**: Rejected due to performance concerns

#### Distributed Rate Limiting Services
- **Approach**: Use commercial rate limiting service (Kong, Envoy, etc.)
- **Pros**: Managed service, feature-rich, well-tested
- **Cons**: Vendor lock-in, higher cost, less control
- **Decision**: Rejected due to cost and control requirements

### 3.14 Success Metrics

We will measure the success of this implementation using the following metrics:

#### Primary Metrics
1. **Rate limit accuracy**: < 0.1% incorrect rate limit decisions
2. **Latency impact**: < 5ms p99 added latency
3. **Availability**: 99.99% uptime for rate limiting service
4. **Customer satisfaction**: < 0.01% of customers report rate limit issues

#### Secondary Metrics
1. **Redis performance**: < 80% CPU utilization at peak
2. **Error rates**: < 0.1% error rate for rate limit operations
3. **Cost efficiency**: Infrastructure cost per million requests
4. **Operational burden**: Mean time to resolve rate limit incidents

#### Monitoring Dashboard
We will create a dedicated dashboard showing:
1. Real-time rate limit decisions (allow/deny)
2. Latency percentiles for rate limit checks
3. Redis cluster health and performance
4. Customer tier usage and limit violations
5. Error rates and failure modes

## 4. Dependencies and Constraints

### 4.1 Existing Systems

- **Authentication service**: Provides customer ID from API keys
- **Billing system**: Uses rate limit data for usage-based billing
- **Monitoring platform**: Receives metrics and alerts
- **Log aggregation**: Receives audit logs

### 4.2 Timeline

- Design review completion: March 25, 2024
- Implementation start: April 1, 2024
- Staging deployment: April 15, 2024
- Production rollout: May 15, 2024

### 4.3 Resource Requirements

- 2 engineers for 6 weeks
- Redis cluster capacity increase (estimated $3,000/month)
- Monitoring and alerting setup (2 weeks)

## 5. Glossary

- **RPS**: Requests per second
- **p99**: 99th percentile latency
- **SLA**: Service Level Agreement
- **TTL**: Time to Live
- **JWT**: JSON Web Token
- **DoS**: Denial of Service