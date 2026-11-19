# Incident Report: Regional Database Outage

**Incident ID:** INC-2024-0012  
**Severity:** SEV-1 (Critical)  
**Start Time:** 2024-01-15 14:32 UTC  
**End Time:** 2024-01-15 15:47 UTC  
**Duration:** 1 hour 15 minutes  
**Service Impact:** TicketBooking service partially unavailable

## Summary
A database connectivity issue in the us-east-1 region caused partial service degradation for 75 minutes. Approximately 40% of users experienced errors during ticket purchase flows.

## Timeline

**14:32 UTC** - Monitoring alerts trigger for increased database connection errors
**14:35 UTC** - On-call engineer acknowledges alert, begins investigation
**14:42 UTC** - Database CPU utilization reaches 95%, query latency spikes
**14:48 UTC** - Manual failover to read replica initiated
**14:53 UTC** - Read replica promotion completes, but application errors persist
**15:02 UTC** - Root cause identified: connection pool exhaustion due to unoptimized query
**15:15 UTC** - Hotfix deployed: increased connection pool size, query optimization
**15:30 UTC** - Service fully restored, monitoring shows normal operation
**15:47 UTC** - Incident resolved, post-mortem process begins

## Root Cause
A recently deployed feature introduced a N+1 query pattern in the seat availability check. During peak traffic, this caused connection pool exhaustion in the primary database. The read replica promotion didn't resolve the issue because the application was configured with hard-coded connection strings instead of using RDS endpoints.

## Impact

### User Impact
- 12,500 users experienced errors during ticket purchase
- 847 failed transactions requiring manual refunds
- Estimated revenue loss: $42,350
- Customer satisfaction score dropped 15 points

### Technical Impact
- Database connection errors: 45,231
- Failed API requests: 89,456
- Maximum error rate: 42%
- Recovery time: 75 minutes (exceeding 60-second RTO)

## Contributing Factors

1. **Lack of query review**: The N+1 pattern wasn't caught during code review
2. **Hard-coded endpoints**: Application used IP addresses instead of DNS endpoints
3. **Inadequate load testing**: Peak traffic scenario not tested with new feature
4. **Slow detection**: Took 10 minutes to identify root cause

## Action Items

### Short-term (Completed)
- [x] Increase database connection pool size
- [x] Optimize seat availability query
- [x] Update documentation for failover procedures
- [x] Implement additional database metrics monitoring

### Medium-term (In Progress)
- [ ] Migrate to RDS proxy for connection management
- [ ] Implement circuit breakers for database calls
- [ ] Add query performance testing to CI/CD pipeline
- [ ] Create automated failover runbooks

### Long-term (Planned)
- [ ] Implement active-active architecture (this project)
- [ ] Add chaos engineering for resilience testing
- [ ] Develop regional failover automation
- [ ] Implement feature flags for gradual rollouts

## Lessons Learned

1. **Query performance matters**: Simple N+1 queries can cause cascading failures
2. **Configuration flexibility**: Hard-coded values hinder recovery operations
3. **Testing coverage**: Load testing must simulate worst-case scenarios
4. **Observability**: Need faster root cause identification tools

## Recommendations for Active-Active Design

Based on this incident, the active-active architecture should address:

1. **Automatic failover**: Reduce manual intervention time
2. **Traffic shedding**: Gracefully handle regional failures
3. **Performance isolation**: Prevent issues from propagating between regions
4. **Improved monitoring**: Cross-region visibility and alerting

---

*Report Generated: 2024-01-20*
*Incident Commander: Alex Chen*
*Participants: Maria Rodriguez, James Wilson, Sarah Kim*