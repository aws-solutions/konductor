# System Architecture Context

## Current Architecture
```
┌─────────────────┐    ┌─────────────┐    ┌─────────────────┐
│   Mobile Apps   │────│  API Gateway│────│  Queue Service  │
│   (iOS/Android) │    │             │    │   (To be chosen)│
└─────────────────┘    └─────────────┘    └─────────────────┘
                                                       │
                                                       ▼
┌─────────────────┐    ┌─────────────┐    ┌─────────────────┐
│  Data Warehouse │◀───│   Lambda    │◀───│   Queue Service  │
│   (Snowflake)   │    │ Processors  │    │                 │
└─────────────────┘    └─────────────┘    └─────────────────┘
```

## Integration Points

### Mobile SDK Integration
- Events sent via HTTPS POST to API Gateway
- Payload: JSON with event metadata and user context
- Authentication: API keys rotated monthly
- Rate limiting: 100 requests/second per API key

### Processing Layer
- AWS Lambda functions as consumers
- Written in Node.js 18.x
- Environment: 1024MB memory, 10-second timeout
- Concurrency: 2-4 functions based on queue depth

### Data Warehouse Integration
- Processed events written to Snowflake
- Batch inserts every 5 minutes
- Schema evolution handled via Avro schemas
- Data retention: 13 months for compliance

## Message Flow
1. Mobile app sends event to API Gateway
2. API Gateway validates and forwards to queue service
3. Queue service buffers event
4. Lambda function polls queue, processes event
5. Processed event written to Snowflake
6. Message deleted from queue

## Failure Handling
- **Transient failures**: Retry with exponential backoff (max 3 attempts)
- **Permanent failures**: Send to dead-letter queue for manual inspection
- **Poison pills**: Isolate and alert after 5 failed attempts
- **Service outages**: Failover to secondary region (15 minute RTO)

## Security Considerations
- All data encrypted at rest (AWS KMS)
- TLS 1.2+ for all communications
- IAM roles with least privilege
- VPC endpoints for internal traffic
- CloudTrail logging for audit trail

## Compliance Requirements
- SOC 2 Type II certification required
- GDPR compliance for EU user data
- HIPAA compliance for healthcare events (future)
- Data residency: US-only storage for now

## Monitoring Stack
- **Metrics**: CloudWatch for queue depth, age, throughput
- **Logs**: CloudWatch Logs for Lambda functions
- **Traces**: X-Ray for distributed tracing
- **Alerts**: SNS notifications for critical issues
- **Dashboards**: Grafana for operational visibility

## Scaling Strategy
- **Horizontal scaling**: Add more Lambda consumers based on queue depth
- **Vertical scaling**: Increase Lambda memory based on processing needs
- **Queue scaling**: SQS auto-scales, Kinesis requires manual shard adjustment
- **Cost-aware scaling**: Scale down during off-peak hours

## Deployment Pipeline
- Infrastructure as Code: CloudFormation templates
- CI/CD: GitHub Actions for deployment
- Environment segregation: Dev, Staging, Production
- Blue/green deployment for queue consumers
- Rollback strategy: 10-minute window for issue detection

## Team Structure
- **Platform Team**: Manages queue infrastructure and monitoring
- **Data Team**: Manages Lambda processors and data warehouse integration
- **Mobile Team**: Manages SDK and API integration
- **SRE Team**: Manages operations and incident response

## Success Metrics
- **Reliability**: 99.9% event processing success rate
- **Latency**: 95% of events processed within 5 seconds
- **Cost Efficiency**: < $900/month for queue infrastructure
- **Operational Load**: < 2 hours/month maintenance
- **Scalability**: Handle 2x current load without architecture changes

*Note: The architecture assumes events are processed within 5 seconds. Previous designs allowed 10 seconds, but user experience requirements tightened this constraint.*