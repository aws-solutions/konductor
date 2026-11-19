# Cost Analysis for Disaster Recovery Options

## Financial Constraints
- **Monthly DR budget allocation**: $12,000 USD
- **Annual capital expenditure limit**: $50,000 USD (one-time setup)
- **Must maintain profitability margin**: Minimum 35% gross margin
- **Cost recovery period**: 3 years maximum

## Infrastructure Cost Components

### Storage Costs (Monthly)
- **Primary region storage**: $0.115 per GB-month (SSD)
- **DR region storage**: $0.125 per GB-month (SSD - lower volume discount)
- **Backup storage (S3)**: $0.023 per GB-month
- **Snapshot storage**: $0.05 per GB-month

### Compute Costs (Monthly)
- **Database instances (c5.4xlarge)**: $0.68 per hour
- **Application instances (m5.2xlarge)**: $0.384 per hour
- **Minimal DR instances (t3.medium)**: $0.0416 per hour

### Network Costs (Monthly)
- **Cross-region data transfer**: $0.02 per GB
- **Intra-region data transfer**: $0.01 per GB
- **VPC peering**: $0.01 per GB

### Managed Services
- **Database replication service**: $2,500/month (flat fee)
- **Monitoring and alerting**: $800/month
- **DR orchestration platform**: $1,200/month

## Historical Spending
- **Current monthly DR spend**: $8,500 (pilot light implementation)
- **Previous quarterly review identified**: $14,200 overspend in Q4 2023 due to unoptimized replication

---

*Financial data source: AWS Cost Explorer, 2024-01*
*Note: All prices in USD, exclude taxes*