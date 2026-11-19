# System Architecture - AnalyticsHub

## Current Architecture

### High-Level Components
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   API Gateway   │    │   Lambda        │
│   (React SPA)   │────│   (HTTP API)    │────│   Functions     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   CloudFront    │    │   RDS Proxy     │    │   PostgreSQL    │
│   (CDN)         │    │   (Connection   │    │   (Metadata)    │
└─────────────────┘    │   Pooling)      │    └─────────────────┘
         │             └─────────────────┘              │
         │                       │                      │
         └───────────────────────┼──────────────────────┘
                                 ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   S3            │    │   ElastiCache   │    │   ClickHouse    │
│   (Static       │    │   (Redis)       │    │   (Analytics)   │
│   Assets)       │    └─────────────────┘    └─────────────────┘
└─────────────────┘
```

### Critical Path Limitations

#### API Gateway
- **Maximum timeout**: 29 seconds (HTTP API configuration limit)
- **Maximum payload**: 100MB (can be configured)
- **Request rate**: 10,000 requests per second (soft limit)
- **Important**: The 29-second timeout is a hard constraint that cannot be increased without moving to REST API (which has different pricing and limits)

#### Lambda Functions
- **Maximum duration**: 900 seconds (15 minutes)
- **Memory**: 128MB to 10,240MB
- **Concurrency**: 1,000 per region (can be increased)
- **Cold starts**: 1-2 seconds average (with provisioned concurrency)

#### Data Layer Constraints
- **PostgreSQL**: 60-second query timeout (configurable)
- **ClickHouse**: 300-second query timeout (configurable)
- **Connection limits**: 100 concurrent connections per database
- **Result set limits**: Practical limit of 10M rows for single query

### Integration Patterns

#### Synchronous Pattern (Current)
```
Frontend → API Gateway → Lambda → Database → Response
```
- **Pros**: Simple, immediate feedback
- **Cons**: Limited by timeout, no progress indication
- **Use case**: Small queries (< 5 seconds)

#### Asynchronous Pattern (Proposed for exports)
```
Frontend → API Gateway → Lambda → SQS → Worker Lambda → S3 → Notification
```
- **Pros**: Handles long-running tasks, scalable
- **Cons**: Complex, delayed results
- **Use case**: Large exports (> 10 seconds)

### Performance Characteristics

#### Network Latency
- Frontend to API Gateway: 50-200ms (regional)
- API Gateway to Lambda: 1-5ms (AWS internal)
- Lambda to Database: 2-10ms (VPC)
- S3 upload/download: 100-500ms per MB

#### Processing Speed
- Query execution: 0.1-10 seconds (depending on complexity)
- Data serialization: 0.4 seconds per 100k rows (measured)
- CSV generation: 0.2 seconds per 100k rows (estimated)
- Compression: 0.1 seconds per 100k rows (gzip)

### Scaling Considerations

#### Vertical Scaling
- Lambda memory: Up to 10GB (faster processing)
- Database instance size: Up to 64 vCPUs, 512GB RAM
- Cache size: Up to 340GB (Redis)

#### Horizontal Scaling
- Lambda concurrency: Up to tens of thousands
- API Gateway: Automatically scales
- Database read replicas: Up to 15 per instance
- S3: Virtually unlimited scale

### Failure Modes

#### Partial Failures
- Database timeout: Retry with smaller time window
- Lambda timeout: Implement checkpointing
- Network issues: Exponential backoff retry
- S3 failures: Multi-part upload with retries

#### Complete Failures
- Region outage: Multi-region deployment needed
- Service degradation: Circuit breaker pattern
- Data corruption: Validation and checksums

### Monitoring and Observability

#### Metrics Collection
- Request duration percentiles (p50, p95, p99)
- Error rates and types
- Resource utilization (CPU, memory, connections)
- Cost tracking per feature

#### Alerting Thresholds
- p95 latency > 10 seconds: Warning
- p99 latency > 29 seconds: Critical (timeout)
- Error rate > 1%: Warning
- Error rate > 5%: Critical
- Cost > 80% of budget: Warning

### Security Considerations
- All data encrypted at rest (AES-256)
- TLS 1.2+ for all transmissions
- IAM roles with least privilege
- VPC isolation for sensitive components
- Audit logging for all data access