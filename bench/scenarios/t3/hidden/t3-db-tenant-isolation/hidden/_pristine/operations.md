# Database Operations Guidelines

## Connection Management

### Pool Configuration
- Maximum pool size: 1,000 connections (hard limit)
- Connection timeout: 30 seconds
- Idle timeout: 300 seconds
- Minimum pool size: 100 connections

### Connection Allocation Strategy
Each tenant requires:
- 1 persistent connection for real-time updates
- Additional connections based on traffic:
  - Low traffic: 0-1 additional connections  
  - Medium traffic: 1-2 additional connections
  - High traffic: 2-3 additional connections

### Scaling Constraints
Due to shared infrastructure limitations:
- **Maximum 1,000 concurrent database connections**
- Each connection consumes ~10MB of memory
- Connection overhead: ~5% CPU utilization at peak

## Backup and Recovery

### RPO/RTO Requirements
- Recovery Point Objective: 15 minutes
- Recovery Time Objective: 
  - Single tenant: 1 hour
  - Full platform: 4 hours

### Backup Strategy
- Incremental backups every 15 minutes
- Full backups weekly
- Retention: 30 days for incrementals, 1 year for fulls

## Monitoring and Alerting

### Critical Metrics
- Connection pool utilization > 80%
- Query latency P95 > 50ms
- Storage utilization > 85%
- CPU utilization > 70%

### Alert Thresholds
- **CONNECTION_POOL_CRITICAL**: > 950 connections
- **STORAGE_BUDGET_WARNING**: > $550/month
- **PERFORMANCE_DEGRADATION**: P95 latency > 100ms

## Schema Migration Procedures

### Zero-Downtime Requirements
All schema changes must support:
- Rolling deployment across tenants
- Backward compatibility for 2 versions
- Automatic rollback on failure detection

### Change Validation
- All migrations must be tested with production-like data volumes
- Performance impact assessment required
- Cost impact analysis mandatory for storage changes