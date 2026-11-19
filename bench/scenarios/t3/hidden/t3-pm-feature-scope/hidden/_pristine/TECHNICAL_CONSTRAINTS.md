# Technical Constraints and Limitations

## Hard Constraints (Cannot Be Changed)

### API Gateway Limits
- **Maximum request timeout**: 29 seconds
- **Reason**: HTTP API configuration limit in AWS
- **Impact**: Any synchronous request taking >29s will fail
- **Workaround**: Use async pattern or reduce data size

### AWS Service Quotas (us-east-1)
- **Lambda concurrent executions**: 1,000 (soft, can be increased)
- **API Gateway requests per second**: 10,000 (soft limit)
- **S3 PUT requests per second**: 3,500 (per prefix)
- **RDS maximum connections**: 1,000 (for db.m5.2xlarge)

### Browser Limitations
- **Maximum blob size for download**: 2GB (Chrome, Firefox)
- **Maximum URL length**: ~2,000 characters
- **Maximum concurrent downloads**: 6 per domain
- **Memory limits for client-side processing**: ~1.5GB

## Soft Constraints (Can Be Changed with Effort)

### Performance Targets
- **p95 response time**: < 10 seconds (user expectation)
- **p99 response time**: < 29 seconds (gateway limit)
- **Error rate**: < 0.1% (SLA requirement)
- **Availability**: 99.9% (business requirement)

### Data Constraints
- **Maximum rows per export**: 10 million (practical limit)
- **Maximum file size**: 1GB (balanced constraint)
- **Character encoding**: UTF-8 (international support)
- **Line endings**: CRLF for Windows compatibility

### Infrastructure Constraints

#### Cost Boundaries
- **Monthly budget**: $1,200 USD (approved)
- **Cost per export target**: < $0.002
- **Infrastructure growth limit**: 50% month-over-month
- **Reserve for spikes**: 20% of budget

#### Capacity Planning
- **Peak concurrent exports**: 100 (based on user research)
- **Average export size**: 1.8MB (calculated)
- **Daily data transfer**: 900GB (500k × 1.8MB)
- **Storage retention**: 7 days (compliance minimum)

## Integration Constraints

### Authentication System
- **Session timeout**: 60 minutes
- **Token refresh**: Every 30 minutes
- **Maximum concurrent sessions**: 3 per user
- **API rate limiting**: 100 requests/minute per user

### Database Access
- **Query timeout**: 60 seconds (PostgreSQL)
- **Result set streaming**: Supported (cursor-based)
- **Maximum columns**: 100 per query (schema limit)
- **Data type mapping**: All PostgreSQL → CSV types

### Third-party Services
- **Email service rate**: 10,000 emails/hour (SES limit)
- **Queue processing**: 1,000 messages/second (SQS)
- **Event scheduling**: 1 minute granularity (EventBridge)
- **File storage**: 5TB standard tier (S3)

## Compliance Constraints

### Data Privacy
- **PII handling**: Must be preserved in exports
- **Data retention**: 7 days minimum, 90 days maximum
- **Access logging**: All exports must be logged
- **Audit trail**: Complete chain of custody

### Security Requirements
- **Encryption at rest**: AES-256 (S3 default)
- **Encryption in transit**: TLS 1.2+ (API Gateway)
- **Access control**: IAM roles with least privilege
- **Input validation**: All parameters sanitized

### Regulatory Requirements
- **GDPR**: Right to data portability
- **HIPAA**: If healthcare data present
- **SOX**: Audit trails for financial data
- **PCI DSS**: If payment data involved

## Development Constraints

### Timeline
- **Phase 1 delivery**: 6 weeks from approval
- **Testing period**: 2 weeks
- **Rollout schedule**: Canary deployment over 1 week
- **Feature complete**: End of Q2 2024

### Team Capacity
- **Developers available**: 2 full-time equivalents
- **DevOps support**: 0.5 FTE
- **QA resources**: 1 FTE
- **Product oversight**: 0.25 FTE

### Technical Debt Considerations
- **Must work with existing authentication**
- **Cannot require database schema changes**
- **Must use existing monitoring framework**
- **Backward compatibility**: 6 months minimum

## Risk Constraints

### High-Risk Scenarios
1. **Timeout cascade**: One slow export blocks others
2. **Cost overrun**: Usage exceeds projections
3. **Data loss**: Export fails mid-process
4. **Security breach**: Unauthorized data access

### Mitigation Requirements
- **Circuit breakers**: For dependent services
- **Budget alerts**: At 50%, 80%, 100% of budget
- **Checkpointing**: For resumeable exports
- **Access reviews**: Monthly permission audits

## Monitoring Constraints

### Required Metrics
- **Export success rate**: Per size category
- **Average duration**: p50, p95, p99
- **Cost per export**: Daily tracking
- **User satisfaction**: CSAT score

### Alerting Requirements
- **p99 duration > 25s**: Warning (approaching timeout)
- **Error rate > 1%**: Immediate investigation
- **Cost > daily target**: Daily report
- **Queue depth > 100**: Scale up workers

### Logging Requirements
- **Each export**: User, size, duration, outcome
- **Each error**: Full context for debugging
- **Cost events**: Service calls and pricing
- **Performance data**: Memory, CPU, network usage

## Testing Constraints

### Test Environment
- **Data volume**: 10% of production scale
- **Performance testing**: Must simulate peak load
- **Failure testing**: Must test timeout scenarios
- **Cost validation**: Must verify within budget

### Acceptance Criteria
- **Functional**: All requirements met
- **Performance**: Within time constraints
- **Reliability**: 99.9% success rate
- **Cost**: Within $1,200/month budget