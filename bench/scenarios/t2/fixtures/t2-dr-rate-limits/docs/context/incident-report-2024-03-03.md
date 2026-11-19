# Incident Report: Redis Cluster Failover
**Date**: March 3, 2024  
**Severity**: SEV-2  
**Duration**: 12 minutes  
**Impact**: Staging environment rate limiting service unavailable

## Timeline

**14:32 UTC**: Redis cluster primary node CPU reaches 95% due to background save operation  
**14:33**: Primary node becomes unresponsive, automatic failover initiated  
**14:34**: Rate limiting middleware begins timing out (100ms timeout)  
**14:35**: 100% of rate limit requests failing, API requests blocked  
**14:37**: On-call engineer paged  
**14:40**: Manual failover to secondary node initiated  
**14:44**: Secondary node promoted to primary, cluster stable  
**14:46**: Rate limiting service restored  

## Root Cause

The Redis cluster was configured with `save 900 1` (save every 15 minutes if at least 1 key changed). During the save operation:

1. Redis forks a child process for RDB persistence
2. Forked process caused temporary CPU spike on already-loaded node
3. Primary node became unresponsive to health checks
4. Automatic failover triggered, but took longer than expected due to cluster state
5. During failover, all writes were blocked

## Impact

- **100% of API requests blocked** for 2 minutes (14:34-14:36)
- **Partial blocking** for 10 minutes (14:32-14:42)
- **Lost test data**: 15,000 test requests
- **Development blocked**: Staging environment unusable

## Key Findings

1. **Rate limiting became a single point of failure**: When Redis was unavailable, ALL API requests were blocked
2. **Timeout too aggressive**: 100ms timeout didn't account for failover scenarios
3. **No graceful degradation**: System had no fallback mechanism
4. **Monitoring gaps**: No alert for "rate limiting disabled" state

## Actions Taken

### Immediate
1. Increased Redis cluster capacity (r6g.2xlarge → r6g.4xlarge)
2. Adjusted RDB save frequency to 30 minutes
3. Implemented temporary workaround: disable rate limiting on Redis failure

### Long-term
1. Design review for failure handling strategy
2. Implement circuit breaker pattern for rate limiting
3. Add fallback to local in-memory counters during outages
4. Improve monitoring and alerting

## Lessons Learned

1. **Dependency criticality**: Rate limiting dependency must be highly available
2. **Failure modes**: Need to test various Redis failure scenarios
3. **Business impact**: Blocking all traffic during infrastructure issues is unacceptable
4. **Capacity planning**: Background operations must be accounted for in capacity planning

## Recommendations for New Design

1. **Fail-open vs fail-closed**: Decide on explicit policy for counter store failures
2. **Degraded operation**: Support partial rate limiting during partial failures
3. **Circuit breakers**: Prevent cascading failures
4. **Health checks**: More sophisticated health checking for Redis cluster