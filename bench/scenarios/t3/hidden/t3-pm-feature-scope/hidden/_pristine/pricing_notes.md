# AWS Pricing Notes for Report Export Feature

## Current AWS Account Configuration
- **Region**: us-east-1 (N. Virginia)
- **Commitment**: No Reserved Instances or Savings Plans
- **Billing**: Pay-as-you-go model
- **Monthly budget for this feature**: $1,200 USD

## Service Pricing Details

### Lambda
- Price: $0.0000166667 per GB-second
- Minimum memory: 128MB (billed in 1ms increments)
- Our configuration: 512MB per function (optimized for report generation)
- Free tier: 1M requests and 400,000 GB-seconds monthly (already consumed by other services)

### API Gateway
- Price: $3.50 per million requests
- Includes: 1TB of data transfer out per month
- Timeout limit: 29 seconds (cannot be increased for HTTP APIs)
- **Important**: Timeout is a hard limit - requests exceeding 29s will be terminated

### S3 (Simple Storage Service)
- Storage: $0.023 per GB-month (Standard tier)
- PUT requests: $0.005 per 1000 requests
- GET requests: $0.0004 per 1000 requests
- Data transfer out: $0.09 per GB (same as general data transfer)

### Data Transfer
- To Internet: $0.09 per GB (first 10TB)
- Regional: $0.01 per GB (between AZs in same region)
- Important for cost estimation: Report downloads count as data transfer out

### Supporting Services
- **SQS**: $0.40 per million requests (for async job queues)
- **SES**: $0.10 per 1000 emails (for notification delivery)
- **EventBridge**: $1.00 per million events (for scheduled triggers)
- **CloudWatch**: $0.50 per GB ingested (for monitoring/logs)

## Cost Optimization Considerations

### Volume Discounts
- S3: > 50TB storage gets 10% discount
- Data transfer: > 10TB/month gets 15% discount
- Not applicable at projected volumes (we're below thresholds)

### Architecture Impact on Costs
1. **Synchronous approach**: Lower infrastructure complexity but higher data transfer costs
2. **Async approach**: Adds S3/SQS/SES costs but reduces failed requests
3. **Scheduled approach**: Lowest data transfer but requires pre-computation

### Historical Cost Data
- Current monthly AWS spend: $8,500 (all services)
- Data warehouse queries: $2,100/month
- Application hosting: $3,200/month  
- Remaining budget for new features: $1,200/month

**Note**: Budget from Q1 2024 was $1,500/month, but was reduced to $1,200/month for Q2 due to company-wide cost optimization. The $1,500 figure is superseded by current $1,200 budget.

## Estimation Methodology
1. Calculate Lambda execution time based on report size
2. Add API Gateway request costs
3. Include data transfer costs (size × $0.09/GB)
4. Add supporting service costs for async/scheduled options
5. Apply monthly volume projections

## Risk Factors
- **Exchange rate fluctuations**: Pricing in USD, our billing in EUR
- **Usage spikes**: Unplanned viral growth could exceed projections
- **Service rate limits**: Could require premium support tiers
- **Data transfer anomalies**: Large reports to specific regions may cost more