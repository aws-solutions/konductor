# Current Notification System Architecture

## Overview
The current notification system is a cron-based batch processing system that has been in production for 3 years. It handles approximately 500 notifications per second at peak.

## Architecture Components

### 1. Notification Queue (PostgreSQL)
- **Table:** `notification_queue`
- **Columns:** `id`, `type`, `user_id`, `content`, `status`, `created_at`, `processed_at`
- **Indexes:** `(status, created_at)` for efficient querying
- **Size:** ~5 million rows, grows by ~50K rows per day
- **Retention:** 30 days (archived to S3)

### 2. Cron Scheduler
- **Schedule:** Every 5 minutes
- **Script:** `/opt/notifications/process_queue.sh`
- **Logic:** 
  1. Select up to 10,000 pending notifications
  2. Group by type (push, email, in-app)
  3. Process each group in parallel
  4. Update status to `sent` or `failed`

### 3. Processing Workers
- **Push Worker:** Python script using `apns2` and `firebase-admin` libraries
- **Email Worker:** Python script using `sendgrid` library
- **In-app Worker:** Node.js script using WebSocket connections
- **Concurrency:** 10 threads per worker type

### 4. Vendor Integrations
- **APNs:** Direct HTTP/2 connections to Apple servers
- **FCM:** HTTP requests to Firebase API
- **SendGrid:** SMTP and API endpoints
- **Internal WebSocket:** Custom Go service

## Data Flow

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   API Services  │───▶│   PostgreSQL    │───▶│   Cron Job      │
│   (creates      │    │   Queue Table   │    │   (every 5 min) │
│   notifications)│    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └────────┬────────┘
                                                       │
                                                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Vendor APIs   │◀───│   Workers       │◀───│   Queue Reader  │
│   (APNs, FCM,   │    │   (Python/Node) │    │   (selects      │
│   SendGrid)     │    │                 │    │   10K rows)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Limitations

### 1. Latency
- **Minimum delay:** 5 minutes (cron interval)
- **Average delay:** 7.5 minutes (queue wait + processing)
- **P95 delay:** 12 minutes during peak loads

### 2. Scalability
- **Maximum throughput:** ~1,000 notifications per 5-minute window
- **Bottlenecks:** Database queries, single cron instance
- **No horizontal scaling:** Single point of failure

### 3. Reliability
- **Single point of failure:** Cron scheduler
- **No retry mechanism:** Failed notifications marked as failed permanently
- **No dead letter queue:** Errors are logged but not re-processed

### 4. Observability
- **Limited metrics:** Basic success/failure counts
- **No distributed tracing:** Difficult to debug delivery issues
- **Manual log analysis:** Requires SSH access to production servers

### 5. Flexibility
- **Fixed schedule:** Cannot process urgent notifications immediately
- **Batch-oriented:** No priority-based processing
- **Hard-coded logic:** Difficult to A/B test delivery strategies

## Performance Characteristics

### Throughput
- **Peak capacity:** 500 notifications per second (burst)
- **Sustained capacity:** 200 notifications per second
- **Current utilization:** 80% at peak hours

### Resource Usage
- **Database:** 4 CPU cores, 16GB RAM (30% utilization)
- **Worker servers:** 2 instances, 8 CPU cores each (40% utilization)
- **Network:** ~50 Mbps outbound during peak

### Error Rates
- **Overall success rate:** 98.7%
- **Push notifications:** 99.1% success rate
- **Email:** 97.5% success rate (higher failure rate due to invalid addresses)
- **In-app messages:** 99.5% success rate

## Incident History

### Major Incidents (Last 12 months)
1. **2023-06-10:** Cron scheduler hung for 2 hours (queue backlog of 1.2M notifications)
2. **2023-09-22:** Database connection pool exhaustion (30% notification failure rate)
3. **2024-01-15:** Duplicate notifications sent to 12,000 users (see incident report)

### Common Issues
- **Queue backlog growth** during vendor outages
- **Memory leaks** in Python workers requiring weekly restarts
- **Clock skew** causing missed cron executions
- **Vendor API changes** requiring manual updates

## Dependencies

### Internal Services
- **User Service:** For user contact information
- **Template Service:** For notification content templates
- **Authentication Service:** For API authentication
- **Monitoring Service:** For metrics and alerts

### External Dependencies
- **Apple APNs:** Push notifications for iOS
- **Google FCM:** Push notifications for Android
- **SendGrid:** Email delivery
- **AWS S3:** Log archiving

## Migration Considerations

### Data Migration
- **Existing queue:** Need to drain or migrate pending notifications
- **Historical data:** 30 days of audit logs need to be accessible
- **User preferences:** Notification settings must be preserved

### Feature Parity
- **All notification types** must be supported
- **Existing templates** must be compatible
- **API contracts** must not break existing integrations

### Rollback Strategy
- **Dual-write period:** Write to both old and new systems
- **Traffic shifting:** Gradual migration with canary deployments
- **Fallback plan:** Revert to cron system if critical issues found