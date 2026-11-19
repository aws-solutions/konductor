# Incident Review: Migration Test Failure

**Date**: 2024-12-15
**Time**: 02:30 - 05:15 UTC
**Severity**: P1 (Production Impact)
**Lead**: Alex Rodriguez

## Summary
During the planned migration dry-run, we experienced a 2-hour service outage when switching traffic from RabbitMQ to Kafka. The rollback took 45 minutes longer than expected.

## Timeline
- **02:30**: Begin cutover - stop producers, wait for queue drain
- **02:45**: Queues appear empty, start Kafka consumers
- **02:47**: First errors in Payment Processor - ordering violations
- **02:50**: Fulfillment service shows duplicate orders
- **03:15**: Decision to rollback
- **03:30**: Start RabbitMQ producers
- **04:45**: Full recovery (45 minutes over target)

## Root Causes
1. **Message ordering not preserved**: Payment Processor requires strict FIFO across partitions. Our Kafka setup used 3 partitions, destroying ordering.
2. **Dual-running gap**: We stopped RabbitMQ producers before Kafka was fully verified, creating a 15-minute message blackout.
3. **Rollback complexity**: Restarting 28 services took longer than planned due to dependency chains.

## Lessons Learned
- **Need ordering guarantee**: Some consumers cannot tolerate out-of-order delivery
- **Better validation**: Must verify each consumer independently before cutting over
- **Rollback triggers**: Need clear, time-bound rollback criteria
- **Communication**: Stakeholders weren't notified of delay until 1 hour in

## Action Items
1. [ ] Determine which services require ordering guarantees
2. [ ] Design Kafka configuration to support ordering where needed
3. [ ] Establish rollback time limit (max 30 minutes from decision)
4. [ ] Create per-service validation checklist
5. [ ] Update communication plan with clearer timelines

## Impact
- **Revenue**: Estimated $18,000 lost during outage
- **Customer**: 342 failed orders, 89 customer complaints
- **Team**: 12 engineers paged, 3 overnight shifts

## Attendees
- Maya Chen (TPM)
- Alex Rodriguez (Platform)
- Lisa Wong (Payment)
- Samir Patel (Order API)
- Tom Harris (Fulfillment)
- Jamie Wilson (Security)

**Next review**: 2025-01-10 to validate fixes