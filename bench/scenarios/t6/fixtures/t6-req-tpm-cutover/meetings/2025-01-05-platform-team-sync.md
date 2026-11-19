# Platform Team Sync

**Date**: 2025-01-05
**Time**: 11:00 - 11:45 UTC
**Lead**: Alex Rodriguez

## Attendees
- Alex Rodriguez
- Taylor Smith (Analytics)
- David Kim (Network)

## Technical Updates

### Kafka Configuration
- Cluster design finalized: 3 brokers, m5.large, 1 TB storage each
- Replication factor: 3 (for HA)
- Partitions: Starting with 10, can scale to 30
- Topic naming: `orders.{service}.{env}`

### Network Setup
- VPC peering in progress
- Security groups configured
- TLS 1.2 required for all connections
- PrivateLink being considered for external services

### Monitoring
- CloudWatch dashboards created
- Custom metrics for consumer lag
- Alerts for >10,000 message lag or >5 minute delay
- Integration with existing PagerDuty

## Open Issues
1. **Ordering guarantee**: How to ensure FIFO for Payment service?
   - Option A: Single partition (limits throughput)
   - Option B: External sequencer (complex)
   - Option C: Accept some reordering with idempotent processing

2. **Dual-running duration**: How long to run both systems?
   - Security policy says 30 days minimum
   - Cost implication: ~$800/month extra
   - Operational burden: Monitoring two systems

3. **Rollback procedure**: Need to document step-by-step
   - Estimated time: 30-45 minutes
   - Risk: Message loss during rollback
   - Need business approval for risk acceptance

## Decisions Needed
1. Ordering approach for Payment service
2. Dual-running timeline
3. Rollback approval threshold

## Next Steps
- [Alex] Draft technical design document
- [Taylor] Test ordering guarantees with prototype
- [David] Complete network setup by Jan 20

**Next sync**: 2025-01-12