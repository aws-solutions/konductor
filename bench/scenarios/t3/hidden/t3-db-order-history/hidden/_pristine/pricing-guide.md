# Cloud Storage Pricing Guide

## Volume Classes

### Standard Volume
- **Base capacity**: 2.5 TB included
- **Max capacity**: 16 TB
- **Base IOPS**: 3,000
- **Max IOPS**: 16,000 (burst)
- **Throughput**: Up to 1,000 MB/s
- **Monthly base fee**: $50 (includes first 2.5 TB)

### Premium Volume
- **Base capacity**: 5 TB included  
- **Max capacity**: 64 TB
- **Base IOPS**: 30,000
- **Max IOPS**: 64,000
- **Throughput**: Up to 4,000 MB/s
- **Monthly base fee**: $150 (includes first 5 TB)

## Usage-Based Pricing

### Storage
- **$0.10 per GB-month** for provisioned storage
- Billed on daily average usage
- Minimum billing unit: 1 GB
- **Example**: 500 GB used for 30 days = $15.00

### Performance
- **$0.10 per 1000 IOPS-month** for provisioned IOPS
- **$0.08 per MB/s-month** for provisioned throughput
- Performance tiers can be adjusted monthly
- **Historical note**: Previous pricing was $0.12/GB-month for storage (superseded by 2024 pricing)

### Example Calculation
A database requiring:
- 1 TB of storage beyond base capacity
- 12,000 provisioned IOPS  
- 250 MB/s throughput

Monthly cost:
- Storage: 1,000 GB × $0.10 = $100.00
- IOPS: (12,000 ÷ 1,000) × $0.10 = $1.20
- Throughput: 250 × $0.08 = $20.00
- **Total usage charges**: $121.20
- **Plus volume class fee**: $50 (Standard) or $150 (Premium)

## Budget Considerations

### Approved Budget
- **Storage infrastructure**: $300/month maximum
- Includes all storage, IOPS, throughput, and volume fees
- Does not include compute, networking, or backup costs
- **Special note**: Finance requires detailed cost breakdown showing storage vs. performance costs

### Cost Optimization Tips
1. Right-size volume class based on capacity needs
2. Monitor actual IOPS usage and adjust provisioned levels
3. Consider data lifecycle policies to archive older data
4. Use compression where possible (note: SQLite supports optional compression)

## Comparison: Standard vs Premium

| Requirement | Standard Volume | Premium Volume |
|-------------|----------------|----------------|
| ≤ 2.5 TB storage | **$50 + usage** | $150 + usage |
| ≤ 5 TB storage | Not possible | $150 + usage |
| ≤ 3,000 IOPS | Included | Overkill |
| 3,000-16,000 IOPS | $0.10/1000 IOPS | Included up to 30,000 |
| > 16,000 IOPS | Not possible | $0.10/1000 IOPS beyond 30,000 |

**Decision guidance**: Choose Standard volume unless you need >2.5 TB storage or >16,000 IOPS.

## Additional Costs

### Backups and Snapshots
- Daily incremental backups: $0.05/GB-month
- On-demand snapshots: $0.02/GB (one-time)
- 30-day retention included for backups

### Data Transfer
- Inbound: Free
- Outbound to internet: $0.09/GB (first 10 GB free)
- Outbound to other cloud services: $0.02/GB

### Support
- Basic: Included (24/7 ticket, 24-hour response)
- Premium: $500/month (1-hour response SLA, dedicated engineer)

## Payment Terms
- Monthly invoicing
- 30-day payment terms
- Volume discounts available at 10+ PB annual commitment