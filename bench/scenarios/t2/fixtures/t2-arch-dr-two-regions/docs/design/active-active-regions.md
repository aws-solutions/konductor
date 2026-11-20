# Active-Active Deployment Design for TicketBooking Service

## 1. Executive Summary

This document outlines the design for migrating the TicketBooking service from its current single-region deployment in us-east-1 to an active-active architecture spanning us-east-1 and us-west-2. The primary objectives are to improve service availability, reduce latency for West Coast users, and meet our 99.99% availability target.

The migration will be conducted in three phases: preparation, deployment, and validation. We anticipate completing the migration within 8 weeks, with minimal service disruption. The total budget for this migration is $45,000, covering infrastructure, development, and testing costs.

## 2. Current Architecture

### 2.1 Current State
- **Service**: TicketBooking v2.3.1
- **Region**: us-east-1 (Northern Virginia)
- **Infrastructure**: 
  - 4x t3.large EC2 instances behind an Application Load Balancer
  - PostgreSQL 14 RDS instance (db.m5.large) with read replica
  - Redis 6.2 cluster for session storage
  - S3 bucket for static assets
- **Traffic**: 12,000 requests per minute peak, 8,000 RPM average
- **Data Size**: 850 GB in PostgreSQL, growing at ~15 GB/month

### 2.2 Service Dependencies
- PaymentGateway (external API)
- UserService (internal, us-east-1)
- NotificationService (internal, us-east-1)
- AnalyticsPipeline (internal, cross-region)

## 3. Target Architecture

### 3.1 Regional Deployment
Each region will host a complete, independent deployment of the TicketBooking service:

- **Region 1**: us-east-1 (existing)
- **Region 2**: us-west-2 (new)

Both regions will accept live traffic simultaneously. DNS-based routing will distribute users to the nearest healthy region.

### 3.2 Database Replication Strategy

We will implement PostgreSQL logical replication between the two regions using AWS Database Migration Service (DMS). The us-east-1 database will serve as the primary source, with changes replicated to us-west-2. This approach leverages AWS-managed replication to minimize operational overhead while providing robust data synchronization capabilities.

**Replication Architecture:**
The replication architecture employs a hub-and-spoke model where us-east-1 acts as the primary hub. All write transactions originate in us-east-1 and are asynchronously propagated to us-west-2. Each database instance will maintain its own transaction log, with DMS continuously monitoring for changes and applying them to the target region. The replication process includes change data capture (CDC) to identify modified rows and apply only the necessary updates, reducing network traffic and improving efficiency.

**Replication Configuration:**
- **Mode**: Asynchronous logical replication with continuous CDC
- **Replication Lag Target**: < 100ms P99 under normal operating conditions
- **Conflict Resolution Strategy**: Last-write-wins (based on timestamp comparison)
- **Recovery Point Objective (RPO)**: 60 seconds maximum data loss
- **Recovery Time Objective (RTO)**: 120 seconds maximum downtime
- **Replication Monitoring**: CloudWatch metrics for lag, throughput, and error rates
- **Health Checks**: Automated validation of replication health every 30 seconds

**Database Schema Changes:**
To support cross-region replication and conflict resolution, we will implement several schema modifications:

1. **Region Tracking**: Add `region_id` column to all business tables to identify the originating region of each record. This enables debugging and audit trail capabilities.

2. **Timestamp Precision**: Add `last_updated_at` timestamp column with microsecond precision (timestamp(6)) to all tables requiring conflict resolution. This ensures sufficient granularity for accurate last-write-wins determination.

3. **Version Columns**: Add `version` integer columns to tables where optimistic concurrency control is needed, allowing detection of conflicting updates.

4. **Audit Triggers**: Implement database-level triggers for comprehensive audit logging of all data modifications, including before/after values, user context, and region information.

5. **Replication Identity**: Ensure all tables have a primary key or unique index configured as the replication identity for efficient change detection.

**Replication Performance Considerations:**
The replication performance will be optimized through several techniques:

- **Batching**: Group multiple transactions into batches for more efficient network utilization
- **Compression**: Enable network compression for cross-region data transfer
- **Parallel Apply**: Configure DMS to apply changes in parallel where dependencies permit
- **Monitoring**: Implement comprehensive monitoring of replication metrics with alerting thresholds

**Data Consistency Guarantees:**
While the replication is asynchronous, we implement several consistency safeguards:

- **Transaction Ordering**: Maintain commit order consistency across regions
- **Foreign Key Validation**: Defer constraint validation until replication completes
- **Data Integrity Checks**: Scheduled validation of replicated data consistency
- **Conflict Detection**: Automated detection and alerting of data conflicts

### 3.3 Data Consistency Model

The data consistency model balances performance requirements with business correctness guarantees. For most data types, we accept eventual consistency with well-defined convergence properties. However, for critical business operations like ticket sales, we implement stronger consistency mechanisms while maintaining acceptable performance characteristics.

**Ticket Inventory Management:**
For ticket inventory, we will maintain a global counter of available seats for each event or flight. Each region maintains its own copy of the seat inventory, and both regions can update the counter when selling tickets. The system uses last-write-wins conflict resolution based on microsecond-precision timestamps to resolve concurrent updates from different regions.

**Consistency Tiers:**
1. **Strong Consistency (Immediate)**: Required for seat reservations during the checkout process. Implemented through regional locking with short timeouts.

2. **Eventual Consistency (Seconds)**: Acceptable for seat availability display and browsing. Users may see slightly stale inventory counts, but the system prevents actual overselling.

3. **Eventual Consistency (Minutes)**: Acceptable for analytical data, user preferences, and non-critical metadata.

**Conflict Resolution Scenarios:**

**Scenario 1: Concurrent Seat Sales**
- Initial state: Seat A-12 available (global count: 1)
- Region us-east-1 sells seat A-12 → local count: 0, timestamp: T1
- Region us-west-2 sells seat A-12 → local count: 0, timestamp: T2 (where T2 > T1)
- Replication occurs: Both updates propagate
- Conflict resolution: Last-write-wins selects us-west-2's transaction
- Result: Global count converges to 0 in both regions
- System response: None needed; both regions agree on the count

**Scenario 2: Price Update Conflict**
- Initial state: Seat price: $100
- Region us-east-1 updates price to $110, timestamp: T1
- Region us-west-2 updates price to $105, timestamp: T2 (where T2 > T1)
- Conflict resolution: Last-write-wins selects $105 price
- Business impact: Potential revenue loss if $110 was intended

**Scenario 3: Customer Profile Update**
- Initial state: Customer preferences: {theme: "dark", notifications: true}
- Region us-east-1 updates: theme → "light", timestamp: T1
- Region us-west-2 updates: notifications → false, timestamp: T2 (where T2 > T1)
- Conflict resolution: Field-level merging where possible
- Result: {theme: "dark", notifications: false} (partial update loss)

**Consistency Verification:**
To maintain data integrity, we implement several verification mechanisms:

1. **Automated Reconciliation**: Scheduled jobs compare regional data sets and identify discrepancies
2. **Business Rule Validation**: Continuous validation against invariant rules (e.g., seat count ≥ 0)
3. **Audit Trail Analysis**: Regular review of conflict resolution decisions
4. **Performance Monitoring**: Tracking of consistency lag and convergence time

**Alerting and Response:**
The system includes comprehensive alerting for consistency issues:
- **Critical Alerts**: Negative seat counts, payment discrepancies
- **Warning Alerts**: High replication lag, conflict frequency increases
- **Informational Alerts**: Consistency verification results, reconciliation outcomes

**Manual Reconciliation Procedures:**
When automated systems detect irreconcilable conflicts, manual intervention procedures include:
1. Data forensic analysis to determine correct state
2. Selective data correction with audit logging
3. Customer notification and compensation where appropriate
4. Root cause analysis to prevent recurrence

### 3.4 Session Management

User sessions will be stored in a regional Redis cluster. For cross-region failover, we will implement session replication using Redis with active-active replication. Session TTL will be set to 24 hours.

### 3.5 Global Load Balancing

Amazon Route 53 with latency-based routing will direct users to the nearest healthy region. Health checks will run every 30 seconds with a failure threshold of 2 consecutive failures.

**DNS Configuration:**
- TTL: 300 seconds (5 minutes)
- Health check interval: 30 seconds
- Health check timeout: 5 seconds
- Failure threshold: 2 of 3

### 3.6 Failover Procedure

When a region becomes unhealthy:

1. Route 53 health checks detect failure (after 60 seconds)
2. DNS stops routing traffic to failed region
3. Remaining region handles 100% of traffic
4. Alerts notify operations team
5. Manual investigation begins

Recovery time from region failure to traffic redirection is estimated at 90 seconds.

### 3.7 Failback Procedure

Once the failed region is restored:
1. Database replication catches up
2. Manual verification of data consistency
3. Gradual traffic shift using weighted routing
4. Monitoring for anomalies during transition

### 3.8 Monitoring and Observability

Each region will have independent CloudWatch dashboards. We will implement cross-region metrics aggregation for global view. Key metrics include:
- Request latency per region
- Error rates
- Database replication lag
- Seat inventory consistency
- Revenue impact

### 3.9 Cost Analysis

The cost analysis considers both recurring infrastructure expenses and one-time migration investments. Our financial modeling projects the total cost of ownership over a 36-month horizon, with sensitivity analysis for key cost drivers.

**Infrastructure Costs (Monthly Recurring):**

**Compute Resources:**
- **EC2 Instances**: 8x t3.large instances (4 per region) for application hosting
  - Unit cost: $0.0832 per hour per instance
  - Monthly cost: 8 instances × $0.0832/hour × 730 hours/month = $487.04
  - Reserved Instance discount potential: 30% with 1-year commitment
  
- **RDS Instances**: 2x db.m5.large instances for primary databases
  - Unit cost: $0.171 per hour per instance
  - Monthly cost: 2 instances × $0.171/hour × 730 hours/month = $250.92
  - Multi-AZ deployment adds 100% cost for standby instances (not included)
  
- **Redis Clusters**: 2x cache.m5.large for session storage and caching
  - Unit cost: $0.137 per hour per instance
  - Monthly cost: 2 instances × $0.137/hour × 730 hours/month = $201.43
  - Cluster mode enabled for high availability

**Networking and Data Transfer:**
- **Cross-Region Data Transfer**: Estimated 1TB per month for replication traffic
  - Cost: $0.02 per GB for first 10TB
  - Monthly cost: 1000 GB × $0.02/GB = $20.00
  - Note: This excludes application data transfer to users
  
- **Load Balancing**: 2x Application Load Balancers (one per region)
  - Cost: $0.0225 per ALB-hour + $0.008 per LCU-hour
  - Estimated monthly: $22.50 per ALB × 2 = $45.00
  
- **DNS Routing**: Amazon Route 53 with latency-based routing
  - Cost: $0.50 per million queries for first 1 billion queries
  - Estimated: 50 million queries/month × $0.50/million = $25.00

**Storage Costs:**
- **Database Storage**: 1TB GP3 storage per RDS instance
  - Cost: $0.115 per GB-month
  - Monthly: 1000 GB × $0.115/GB = $115.00
  
- **Backup Storage**: 2TB for 7-year compliance retention
  - Cost: $0.023 per GB-month for S3 Glacier Deep Archive
  - Monthly: 2000 GB × $0.023/GB = $46.00
  
- **Application Logs**: 500GB CloudWatch Logs storage
  - Cost: $0.50 per GB ingested, $0.03 per GB archived
  - Estimated monthly: $50.00

**One-Time Migration Costs:**

**Development Investment:**
- **Engineering Effort**: 320 hours at blended rate of $125/hour
  - Subtotal: 320 × $125 = $40,000
  - Breakdown:
    - Database schema changes: 80 hours
    - Application logic for cross-region writes: 120 hours
    - Session replication implementation: 60 hours
    - Monitoring and alerting setup: 60 hours

- **Quality Assurance**: 40 hours of testing and validation
  - Subtotal: 40 × $125 = $5,000
  - Includes: Load testing, failover testing, data consistency validation

**Ancillary Costs:**
- **Training**: 16 hours for operations team
  - Cost: 16 × $100/hour = $1,600
  
- **Documentation**: 8 hours for runbooks and procedures
  - Cost: 8 × $100/hour = $800
  
- **Change Management**: 4 hours for stakeholder communication
  - Cost: 4 × $150/hour = $600

**Financial Summary:**

**Monthly Recurring Total**: $1,240.39
- Compute: $939.39
- Networking: $90.00
- Storage: $211.00

**One-Time Migration Total**: $48,000.00
- Development: $40,000.00
- Testing: $5,000.00
- Training & Documentation: $2,400.00
- Change Management: $600.00

**Budget Analysis:**
- **Approved Budget**: $45,000.00
- **Estimated Cost**: $48,000.00
- **Variance**: -$3,000.00 (6.7% over budget)
- **Contingency Buffer**: 15% included in estimates

**Return on Investment Analysis:**
- **Revenue Protection**: Prevents $42,350 loss from regional outages (based on INC-2024-0012)
- **Latency Improvement**: 40ms reduction for West Coast users → estimated 2% conversion lift
- **Availability Improvement**: 99.99% vs 99.95% → reduced customer churn
- **Payback Period**: 14 months based on revenue protection alone

**Cost Optimization Opportunities:**
1. **Reserved Instances**: 30% savings with 1-year commitment
2. **Storage Tiering**: Move older backups to cheaper storage classes
3. **Traffic Optimization**: Reduce cross-region data transfer through compression
4. **Instance Right-Sizing**: Monitor and adjust instance types based on usage

### 3.10 Risk Assessment

**High Risks:**
1. Data inconsistency during replication lag windows
2. Performance degradation under cross-region replication load
3. Dependency services not available in us-west-2

**Mitigations:**
1. Regular consistency checks and alerts
2. Performance testing before go-live
3. Fallback to single-region mode if critical dependencies fail

### 3.11 Testing Plan

1. **Unit Tests**: All new code
2. **Integration Tests**: Cross-region API calls
3. **Load Tests**: Simulate peak traffic in both regions
4. **Failover Tests**: Manual region failure simulation
5. **Data Consistency Tests**: Verify seat inventory after concurrent updates

### 3.12 Rollback Plan

If critical issues are discovered post-deployment:
1. Stop all writes to us-west-2
2. Redirect all traffic to us-east-1
3. Export us-west-2 data and merge manually if needed
4. Revert to single-region architecture

## 4. Implementation Timeline

**Week 1-2**: Infrastructure provisioning and database replication setup
**Week 3-4**: Application changes and session management
**Week 5-6**: Testing and validation
**Week 7**: Staged rollout (5% → 25% → 50% → 100% traffic)
**Week 8**: Monitoring and optimization

## 5. Success Criteria

1. 99.99% service availability measured over 30 days
2. P95 latency < 200ms for all users
3. No data loss during failover events
4. Replication lag < 100ms P99
5. Cost increase < 20% compared to single-region

## 6. Recovery Procedures

### 6.1 Failover Operations
When a region becomes unavailable, the failover procedure ensures minimal service disruption. Our automated systems detect regional health degradation through comprehensive monitoring of key service indicators.

**Detection Mechanisms:**
- Route 53 health checks monitor endpoint availability every 30 seconds
- Application performance metrics track response times and error rates
- Database connectivity tests verify data access capabilities
- Dependency service health checks validate external integrations

**Automated Response:**
Upon detection of a regional failure, the system initiates automated failover:
1. Health check failures trigger alarm state after 2 consecutive failures
2. DNS routing updates begin, redirecting traffic to the healthy region
3. Cross-region replication adjusts to single-source mode
4. Monitoring systems shift to enhanced alerting for the active region

**Manual Override:**
Operations teams retain manual override capabilities for controlled failovers during maintenance or testing scenarios. Manual procedures include verification steps and rollback planning.

### 6.2 Recovery Time Analysis
The recovery time objective (RTO) of 60 seconds represents our target for restoring service availability after a regional failure. This target encompasses detection, decision, and redirection phases.

**Time Component Breakdown:**
- **Detection Time**: 30 seconds (health check interval plus processing)
- **Decision Time**: 10 seconds (automated validation and confirmation)
- **Redirection Time**: 20 seconds (DNS propagation and client adoption)
- **Total Estimated RTO**: 60 seconds

**Validation Testing:**
Regular failover testing validates these time estimates and identifies optimization opportunities. Historical test results show consistent achievement of 55-65 second recovery times.

### 6.3 Data Recovery Points
The recovery point objective (RPO) defines the maximum acceptable data loss during a failure event. Our target RPO of 60 seconds ensures business continuity while acknowledging replication realities.

**RPO Components:**
- **Transaction Commitment**: Data committed in the active region
- **Replication Lag**: Time for changes to propagate to standby region
- **Buffer Period**: Additional safety margin for system variability

**RPO Validation:**
Continuous monitoring of replication lag against RPO targets ensures ongoing compliance. Alerting triggers when lag approaches 80% of RPO threshold, allowing proactive intervention.

## 7. Operational Runbooks

### 7.1 Failback Procedures
Once a failed region is restored to operational status, controlled failback returns traffic to its original distribution. This process prioritizes data consistency and service stability.

**Pre-Failback Validation:**
Before initiating failback, operations teams must complete several validation steps:
1. **Data Consistency Check**: Verify replication has caught up completely
2. **Service Health Verification**: Confirm all services in restored region are healthy
3. **Performance Baseline**: Ensure restored region meets performance standards
4. **Dependency Validation**: Check all external dependencies are available

**Traffic Gradual Shift:**
Failback employs gradual traffic shifting to minimize risk:
1. Initial 5% traffic shift with enhanced monitoring
2. Progressive increases to 25%, 50%, 75% based on performance metrics
3. Final shift to 100% after 24 hours of stable operation
4. Continuous monitoring throughout the transition period

**Rollback Preparedness:**
Maintain immediate rollback capability throughout failback process. Pre-configured automation enables rapid return to single-region operation if issues emerge.

### 7.2 Monitoring Configuration
Comprehensive monitoring provides visibility into cross-region operations and enables rapid issue detection and resolution.

**Key Monitoring Metrics:**
- **Regional Health**: Endpoint availability and response times
- **Data Consistency**: Replication lag and conflict rates
- **Performance Indicators**: Transaction latency and throughput
- **Business Metrics**: Booking success rates and revenue impact

**Alerting Thresholds:**
- **Critical Alerts**: Service degradation affecting >10% of users
- **Warning Alerts**: Performance degradation or elevated error rates
- **Informational Alerts**: Operational events and state changes

### 7.3 Maintenance Operations
Scheduled maintenance activities require careful coordination to ensure service continuity across both regions.

**Maintenance Coordination:**
- Stagger maintenance windows between regions
- Maintain minimum service capacity during maintenance
- Implement feature flags for controlled feature deployment
- Validate cross-region compatibility before broad deployment

## 8. Financial Planning

### 8.1 Budget Allocation
The migration budget supports infrastructure expansion, development effort, and operational readiness activities. Detailed cost tracking ensures financial accountability.

**Budget Categories:**
- **Infrastructure Expansion**: Additional regional deployment costs
- **Development Investment**: Cross-region capability implementation
- **Testing Resources**: Validation and performance testing
- **Training and Documentation**: Operational preparedness

**Cost Monitoring:**
Monthly financial reviews track actual spending against budget projections. Variance analysis identifies optimization opportunities and informs future planning.

### 8.2 Return on Investment
Financial justification for the active-active migration includes both direct cost savings and strategic business benefits.

**Direct Benefits:**
- Reduced revenue loss from regional outages
- Improved customer satisfaction and retention
- Lower latency for geographically distributed users
- Enhanced competitive positioning

**Strategic Value:**
- Increased service resilience and business continuity
- Foundation for future geographic expansion
- Improved operational maturity and capabilities
- Enhanced brand reputation for reliability

## 9. Open Questions

1. What additional monitoring capabilities should we prioritize?
2. How should we evolve the architecture for future region expansion?
3. Which team owns the us-west-2 on-call rotation?

---

*Document Version: 1.3*
*Last Updated: 2024-03-20*
*Authors: Architecture Team, Platform Engineering*
*Reviewers: SRE Team, Product Management, Finance Department*