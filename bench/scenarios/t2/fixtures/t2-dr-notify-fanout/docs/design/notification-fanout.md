# Design: Notification Fanout Service

**Version:** 1.2  
**Date:** March 1, 2024  
**Status:** For Review  
**Replaces:** Cron-based notification system

## 1. Motivation

Our current notification system relies on cron jobs that run every 5 minutes to batch-send notifications. This approach has several limitations:

- **Latency:** Users can wait up to 5 minutes for time-sensitive notifications
- **Scalability:** Batch processing creates spikes in load to downstream services
- **Reliability:** Single point of failure in the cron scheduler
- **Flexibility:** Difficult to implement different delivery strategies per notification type

The new Notification Fanout Service will provide real-time, reliable delivery of push notifications, emails, and in-app messages with configurable delivery strategies and improved observability.

## 2. Goals

### 2.1 Primary Goals
- Process 10,000 notifications per second at peak capacity
- Achieve 99.95% availability (SLA)
- Deliver notifications with median latency under 500ms
- Support at-least-once delivery semantics
- Provide end-to-end observability with metrics and tracing

### 2.2 Secondary Goals
- Support gradual rollout and canary deployments
- Enable A/B testing of notification delivery strategies
- Provide cost-effective scaling based on load
- Maintain compatibility with existing notification formats

## 3. Non-goals
- Real-time notification preview in admin UI
- User preference management (handled by separate service)
- Notification content generation (handled by content service)
- Historical analytics beyond 30 days
- Support for SMS notifications (phase 2)

## 4. Design Overview

### 4.1 Architecture

The service follows an event-driven architecture:

```
Notification API → Message Queue → Fanout Workers → Vendor APIs (Push/Email/In-app)
```

1. **Notification API:** Receives notification requests from internal services
2. **Message Queue:** Apache Kafka for durable, ordered message storage
3. **Fanout Workers:** Stateless workers that process messages and call vendor APIs
4. **Vendor Integrations:** Abstraction layer for APNs, FCM, SendGrid, etc.

### 4.2 Data Flow

1. Internal service publishes notification to `/v1/notifications`
2. Notification validated and enriched with user contact data
3. Event written to Kafka topic `notifications.v1`
4. Fanout workers consume events, apply delivery logic
5. Workers call appropriate vendor API
6. Delivery status written to audit log

## 5. Detailed Design

### 5.1 Notification Format

```json
{
  "id": "uuid-v4",
  "type": "push|email|in_app",
  "user_id": "user-123",
  "template_id": "welcome-email",
  "content": { "title": "...", "body": "..." },
  "metadata": {
    "priority": "high|normal|low",
    "schedule_at": "2024-03-15T10:00:00Z",
    "expires_at": "2024-03-16T10:00:00Z"
  }
}
```

### 5.2 Queue Design

We'll use Apache Kafka with the following configuration:

- **Topic:** `notifications.v1`
- **Partitions:** 12 (for 12 consumer groups)
- **Retention:** 7 days
- **Replication factor:** 2

Each notification type (push, email, in-app) will have dedicated consumer groups to enable independent scaling.

### 5.3 Consumer Design

Consumers are stateless Go applications that subscribe to Kafka topics and process notifications. Each consumer group is dedicated to a specific notification type to enable independent scaling and failure isolation.

#### 5.3.1 Batch Processing
- Consumers process messages in configurable batches (default: 100 messages)
- Batch size optimized for vendor API characteristics (smaller for push, larger for email)
- Processing timeout of 30 seconds per batch to prevent stuck consumers
- Commit offset only after successful processing of entire batch

#### 5.3.2 Retry Strategy
- Exponential backoff with jitter: 1s, 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s
- Maximum retry duration of 10 minutes per message
- A message still failing after 10 minutes is re-queued to the same Kafka topic, so no notification is ever dropped
- Circuit breaker pattern after 5 consecutive failures to same vendor endpoint

#### 5.3.3 Delivery Guarantees
- Kafka provides at-least-once delivery semantics
- Kafka's offset management keeps consumers in step: a batch's offsets are committed only after the batch completes, so a rebalance never loses messages

#### 5.3.4 Error Handling
- Vendor API errors (4xx, 5xx) trigger immediate retry with backoff
- Network timeouts retry with same backoff schedule
- Invalid message format logs error and skips message
- Consumer crashes trigger partition rebalance to other instances

#### 5.3.5 Monitoring
- Each consumer emits metrics for processed count, error rate, batch latency
- Consumer lag monitored via Kafka metrics
- Detailed logs for each delivery attempt including vendor response codes
- Alert on consumer lag exceeding 1000 messages or error rate > 5%

### 5.4 Vendor Integration

#### 5.4.1 Push Notifications
- **Apple Push Notification Service (APNs):** Token-based authentication
- **Firebase Cloud Messaging (FCM):** Server key authentication
- **Rate limits:** Vendor-specific (see vendor-limits.yaml)

#### 5.4.2 Email
- **Primary:** SendGrid API
- **Fallback:** Amazon SES
- **Rate limits:** 100 emails per second per account

#### 5.4.3 In-app Messages
- **WebSocket connections** maintained by separate service
- **Redis pub/sub** for message distribution
- **Rate limits:** None (internal service)

### 5.5 Capacity Planning

**Current Traffic Analysis:**
Reviewing the traffic-by-hour.csv data shows clear diurnal patterns with peak usage during business hours. The maximum observed rate is 550 notifications per second at hour 17 (5 PM local time). This aligns with user activity patterns where engagement peaks after work hours. Email notifications show consistent baseline throughout the day while push notifications exhibit stronger peak characteristics.

**Growth Projections:**
- Current peak: 500 notifications per second (conservative estimate from hourly data)
- Month-over-month growth: 20% based on product adoption forecasts
- 3-month projection: 500 * 1.2^3 = 864 notifications per second
- 6-month projection: 500 * 1.2^6 = 1,492 notifications per second
- 12-month projection: 500 * 1.2^12 = 4,458 notifications per second

**Design Capacity:**
We're designing the system for 10,000 notifications per second to provide substantial headroom for unexpected growth spikes and marketing campaigns. This 20x buffer over current peak allows for:
- Handling viral content or emergency notifications
- Accommodating higher-than-projected growth rates
- Supporting seasonal peaks (holiday seasons, product launches)
- Providing capacity for new notification types in future phases

**Resource Allocation:**
The service will be deployed on AWS EKS with the following resource profile:
- **Initial deployment:** 6 worker pods (2 per notification type: push, email, in-app)
- **Pod specifications:** 1 CPU core, 2GB memory, 10GB ephemeral storage
- **Auto-scaling configuration:** Horizontal Pod Autoscaler with custom metrics
  - Scale up when queue depth exceeds 1000 messages per pod
  - Scale down when queue depth below 100 messages for 5 minutes
  - Minimum pods: 2 per notification type (6 total)
  - Maximum pods: 20 per notification type (60 total)
- **Kafka cluster:** 3 brokers, 12 partitions per topic, replication factor 2
- **Estimated resource utilization at design capacity:**
  - CPU: 40 cores (10,000 msg/sec ÷ 250 msg/sec per core)
  - Memory: 80GB (2GB per pod × 40 pods)
  - Network: ~100 Mbps egress to vendor APIs

**Cost Implications:**
At full design capacity, monthly infrastructure costs are estimated at $5,000 including EKS, Kafka, monitoring, and data transfer. Vendor costs scale linearly with volume, primarily driven by email delivery through SendGrid at $0.10 per 1000 emails.

### 5.6 Availability

**Availability Target:** 99.95% monthly availability, which translates to approximately 4.38 hours of allowable downtime per year. This target aligns with business requirements for notification delivery reliability and user expectations for timely receipt of important communications.

**Deployment Architecture:**
The service will be deployed in a single AWS us-east-1 availability zone (us-east-1a) to simplify operational complexity and reduce cross-zone data transfer costs. Within this zone, we'll leverage Kubernetes' built-in high availability features:

- **Kubernetes Deployment Strategy:** Rolling updates with maxUnavailable set to 25% and maxSurge set to 25%
- **Pod Disruption Budget:** Allow at most 1 pod per notification type to be unavailable during voluntary disruptions
- **Readiness Probes:** HTTP endpoints that verify consumer connectivity to Kafka and vendor APIs
- **Liveness Probes:** Detect and restart pods stuck in processing loops or deadlock states
- **Node Affinity:** Spread pods across multiple worker nodes within the availability zone

**Failure Scenarios and Mitigations:**

1. **Pod Failures:** Kubernetes automatically reschedules pods to healthy nodes
2. **Node Failures:** Pods restart on remaining nodes; temporary capacity reduction
3. **AZ Outage:** Service becomes unavailable until manual intervention (see Disaster Recovery)
4. **Kafka Broker Failure:** With replication factor 2, remaining brokers continue serving traffic
5. **Vendor API Outages:** Circuit breakers prevent cascading failures; notifications queue for retry

**Disaster Recovery Plan:**
- **Recovery Time Objective (RTO):** 4 hours to restore service in alternate AZ
- **Recovery Point Objective (RPO):** 15 minutes of notification data loss acceptable
- **Backup Strategy:** Daily snapshots of Kafka topics to S3
- **Failover Procedure:** Manual process requiring 2 engineers, estimated 2-3 hours

**Monitoring and Alerting:**
- Availability calculated as (successful_deliveries / total_attempts) over 1-minute intervals
- Alert triggered when 5-minute availability drops below 99%
- PagerDuty escalation for availability below 95% for 15 minutes
- Weekly availability reports with trend analysis and improvement recommendations

### 5.7 Data Management

#### 5.7.1 User Contact Data
User contact information (device tokens, email addresses) will be:
- Included in each queued notification event
- Stored in Kafka for 7 days (queue retention)
- Archived to S3 for 30 days for audit purposes
- Protected by TLS between services

#### 5.7.2 Audit Logs
- All delivery attempts logged to CloudWatch
- Success/failure metrics aggregated in Datadog
- Raw logs retained for 30 days in S3

### 5.8 Quiet Hours Handling

**User Preference Respect:** To respect user sleep schedules and reduce notification fatigue, the system implements configurable quiet hours during which non-urgent notifications are withheld from delivery.

**Default Configuration:**
- **Quiet hours:** 10:00 PM to 8:00 AM in US/Eastern timezone (UTC-5/UTC-4)
- **Applicable days:** Every day of the week
- **Notification types affected:** All non-urgent push notifications and emails
- **Exempt notifications:** Security alerts, transaction confirmations, password resets

**Implementation Details:**
1. **Time Zone Handling:** The system uses a fixed US/Eastern timezone for all quiet hour calculations. User local time zones are not considered in the initial implementation to reduce complexity.
2. **Urgency Classification:** Each notification includes an `urgency` field (urgent/normal/low). Only urgent notifications bypass quiet hours.
3. **Queue Behavior:** Notifications received during quiet hours are:
   - Immediately processed if marked urgent
   - Delayed until 8:00 AM Eastern if non-urgent
   - Stored in Kafka with future delivery timestamp
   - Consumers skip messages with future timestamps
4. **Configuration Management:**
   - Default quiet hours stored in service configuration
   - Per-user overrides via User Preference Service (external dependency)
   - Admin API for emergency override during critical events

**Technical Implementation:**
```go
func shouldDeliver(notification Notification, currentTime time.Time) bool {
    // Convert current time to US/Eastern
    loc, _ := time.LoadLocation("America/New_York")
    easternTime := currentTime.In(loc)
    
    // Check if within quiet hours (10 PM to 8 AM)
    hour := easternTime.Hour()
    inQuietHours := hour >= 22 || hour < 8
    
    // Urgent notifications always deliver
    if notification.Urgency == "urgent" {
        return true
    }
    
    // Non-urgent notifications skip quiet hours
    return !inQuietHours
}
```

**Future Enhancements (Phase 2):**
- Per-user timezone detection based on IP or device settings
- Custom quiet hour ranges per user
- Smart quiet hours learning from user interaction patterns
- Vacation mode with extended quiet periods

## 6. Rollout Plan

### 6.1 Phase 1: Foundation (Weeks 1-2)
- Deploy basic service with test notifications
- Integrate with development environment
- Establish monitoring and alerting

### 6.2 Phase 2: Gradual Traffic (Weeks 3-4)
- Route 10% of non-critical notifications to new system
- Monitor performance and error rates
- Adjust scaling parameters

### 6.3 Phase 3: Full Migration (Weeks 5-6)
- Migrate 100% of notifications
- Decommission old cron system
- Post-migration optimization

## 7. Risks and Mitigations

### 7.1 Technical Risks
- **Vendor API outages:** Implement circuit breakers and fallback providers
- **Queue backlog:** Auto-scaling based on queue depth
- **Data loss:** Kafka replication and regular backups

### 7.2 Operational Risks
- **Team familiarity:** Training sessions and documentation
- **Monitoring gaps:** Implement comprehensive dashboards
- **Cost overruns:** Budget alerts and cost optimization

### 7.3 Security Risks
- **Data exposure:** Ensure all PII is properly handled
- **API abuse:** Rate limiting and authentication
- **Compliance:** Regular security reviews and audits

## 8. Metrics and Monitoring

### 8.1 Key Metrics
- Notifications processed per second
- End-to-end latency (p50, p95, p99)
- Success rate by notification type
- Queue depth and consumer lag
- Vendor API response times

### 8.2 Alerts
- P95 latency > 2s for 5 minutes
- Success rate < 99% for 10 minutes
- Consumer lag > 1000 messages
- Vendor error rate > 5%

## 9. Open Questions
- Should we implement priority queuing?
- Optimal batch size for different notification types?
- Cost trade-offs between different vendor plans?

## 10. Appendix

### 10.1 Glossary
See glossary.md for terminology definitions.

### 10.2 References
- Current architecture: current-architecture.md
- Traffic patterns: traffic-by-hour.csv
- Vendor limits: vendor-limits.yaml
- Cost estimates: cost-estimate.yaml
- Past incidents: incident-2024-01-15.md