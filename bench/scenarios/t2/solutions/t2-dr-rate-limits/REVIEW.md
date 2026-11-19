# Design Review: API Rate Limiting

**Reviewer**: Senior Platform Engineer  
**Date**: March 20, 2024  
**Status**: Requires significant revisions

## Overall Assessment

The design addresses an important need for consistent rate limiting but has several critical gaps that must be resolved before implementation. The failure handling strategy is dangerously undefined, performance calculations are optimistic, and contract compliance issues could lead to SLA violations.

The most urgent concerns are:
1. **Failure mode ambiguity** - No clear policy for Redis failures, risking complete API outage
2. **Algorithm mismatch** - Fixed window violates contractual rolling window requirements
3. **Latency budget violation** - Two Redis round trips exceed 5ms p99 target

## Findings

### Critical Issues

**Failure Handling Strategy (Section 3.4)**  
The design states rate limiting will be "temporarily disabled" during counter store failures but provides no implementation details or decision criteria. The March 3 incident showed that failing closed blocks all traffic, which is unacceptable. Need explicit fail-open/fail-closed policy with circuit breaker implementation.

**Fixed Window Algorithm (Section 3.1)**  
Using fixed windows allows customers to send 2x their limit at window boundaries (e.g., 1000 requests at 23:59:59 plus 1000 at 00:00:00). This violates contract wording about "any rolling 60-second period." Consider sliding window or token bucket algorithms.

**Latency Budget Exceeded (Section 3.5)**  
Two Redis round trips (GET + INCR) with cross-AZ latency (2ms p99 each) plus network overhead exceeds the 5ms p99 budget. Pipeline operations or use Redis Lua scripts for atomic check-and-increment in one round trip.

### High Priority Issues

**Server Clock Dependency (Section 3.1)**  
Window keys based on `int(time.time() / 60)` using server clocks with known skew causes inconsistent rate limiting across servers. Use centralized time service or Redis time for window synchronization.

**Enterprise Customer Support (Section 3.3)**  
Design only covers standard tiers. Enterprise contracts have complex requirements: peak-hour adjustments (Acme Corp), burst allowances, geographic distribution (Globex), per-department limits (Initech). Need dynamic limit configuration system.

**Missing Response Headers (Section 3.10)**  
SDK documentation requires `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers for proper client backoff. Current response format lacks these, breaking SDK integration.

### Medium Priority Issues

**Redis Replication Consistency (Section 3.2)**  
During failover or under load, reading from replicas with replication lag could cause stale count readings. Need read-after-write consistency or quorum reads for critical customers.

**Circuit Breaker Monitoring (Section 3.6)**  
Monitoring doesn't track when rate limiting enters degraded mode (circuit breaker open). Need alerts for degraded operation and metrics for failure mode durations.

## Recommendations

1. **Adopt sliding window algorithm** using Redis sorted sets or approximate counting
2. **Implement circuit breaker pattern** with explicit fail-open policy for critical APIs
3. **Use Redis Lua scripts** for atomic check-and-increment in single round trip
4. **Add configuration system** for enterprise contract terms
5. **Implement required response headers** per SDK documentation
6. **Use Redis time or NTP-synchronized clocks** for window boundaries
7. **Add read-your-writes consistency** for enterprise customers

The design needs significant revision before implementation can begin. Focus on failure handling, algorithm correctness, and performance first.

```json
[
  {
    "location": "3.4",
    "severity": "critical",
    "issue": "Failure handling strategy is undefined for counter store unavailability, risking complete API outage during Redis failures.",
    "fix": "Implement circuit breaker with explicit fail-open policy for critical APIs, fail-closed for non-critical."
  },
  {
    "location": "3.1",
    "severity": "high",
    "issue": "Fixed window algorithm allows double the limit at window boundaries, violating contract wording about rolling windows.",
    "fix": "Replace with sliding window algorithm using Redis sorted sets or token bucket."
  },
  {
    "location": "3.5",
    "severity": "high",
    "issue": "Two Redis round trips exceed 5ms p99 latency budget given cross-AZ network latency.",
    "fix": "Use Redis Lua script for atomic check-and-increment in single round trip."
  },
  {
    "location": "3.1",
    "severity": "medium",
    "issue": "Window keys based on server clocks with known skew cause inconsistent rate limiting across servers.",
    "fix": "Use Redis time or NTP-synchronized centralized clock service for window boundaries."
  },
  {
    "location": "3.3",
    "severity": "medium",
    "issue": "Design doesn't support enterprise customers with contract-specific limits like peak-hour adjustments or burst allowances.",
    "fix": "Add dynamic limit configuration system supporting contract terms from customer-contracts.md."
  },
  {
    "location": "3.10",
    "severity": "medium",
    "issue": "Response format lacks required Retry-After and X-RateLimit headers that client SDK documentation states are mandatory.",
    "fix": "Add Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers to 429 responses."
  },
  {
    "location": "3.2",
    "severity": "low",
    "issue": "Redis replication lag could cause inconsistent rate limiting if reads go to replicas during failover.",
    "fix": "Implement read-your-writes consistency for enterprise customers or use quorum reads."
  },
  {
    "location": "3.6",
    "severity": "low",
    "issue": "Monitoring lacks circuit breaker state tracking and doesn't alert when rate limiting enters degraded mode.",
    "fix": "Add metrics for circuit breaker states and alerts for degraded operation duration."
  }
]
```