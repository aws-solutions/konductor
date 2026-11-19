# Cloud Infrastructure Pricing Guide
## Effective November 1, 2024 - October 31, 2025

### Overview
This document provides pricing information for cloud compute resources available for the CloudStream service. All prices are in US Dollars and exclude applicable taxes.

### Compute Instance Pricing

#### On-Demand Instances (us-east-1)
| Instance Type | vCPU | Memory | Network | RPS Capacity* | Hourly Rate | Daily Cost | Monthly Cost** |
|---------------|------|--------|---------|---------------|-------------|------------|----------------|
| Medium | 8 | 16 GB | 10 Gbps | 900 | $0.38 | $9.12 | $273.60 |
| Large | 16 | 32 GB | 20 Gbps | 1,800 | $0.68 | $16.32 | $489.60 |
| X-Large | 32 | 64 GB | 25 Gbps | 3,600 | $1.25 | $30.00 | $900.00 |

*RPS Capacity measured at 100% CPU utilization under standardized load test
**Monthly cost based on 720 hours (30 days × 24 hours)

#### Reserved Instances (us-east-1, 1-Year Term)
| Instance Type | Upfront Fee | Effective Hourly | Savings vs On-Demand |
|---------------|-------------|------------------|----------------------|
| Medium | $1,200 | $0.228 | 40% |
| Large | $2,100 | $0.408 | 40% |
| X-Large | $3,900 | $0.750 | 40% |

#### Regional Price Variations
| Region | Price Multiplier | Notes |
|--------|------------------|-------|
| us-east-1 | 1.00x | Baseline (Virginia) |
| us-west-2 | 1.10x | Oregon - 10% premium |
| eu-west-1 | 1.08x | Ireland - 8% premium |
| ap-southeast-1 | 1.15x | Singapore - 15% premium |

### Storage Costs

#### Block Storage
- **General Purpose SSD**: $0.08/GB-month (us-east-1)
- **Provisioned IOPS SSD**: $0.125/GB-month + $0.065/provisioned IOPS-month
- **Throughput Optimized HDD**: $0.045/GB-month
- **Cold HDD**: $0.025/GB-month

#### Object Storage
- **Standard tier**: $0.023/GB-month (first 50 TB)
- **Infrequent Access**: $0.0125/GB-month + $0.01/GB retrieval
- **Archive tier**: $0.004/GB-month + $0.02/GB retrieval

### Data Transfer Costs

#### Regional (Within same cloud provider)
- **Between AZs in same region**: $0.01/GB
- **Between regions**: $0.02/GB
- **Internet egress**:
  - First 10 TB/month: $0.09/GB
  - Next 40 TB/month: $0.085/GB
  - Next 100 TB/month: $0.07/GB
  - Over 150 TB/month: $0.05/GB

#### Cross-Cloud
- **To other cloud providers**: $0.12/GB
- **To CDN**: $0.085/GB

### Additional Services

#### Load Balancing
- **Application Load Balancer**: $0.0225/hour + $0.008/GB processed
- **Network Load Balancer**: $0.0225/hour + $0.006/GB processed

#### Database Services
- **Managed PostgreSQL**: $0.046/hour per vCPU (includes 5 GB storage)
- **Managed Redis**: $0.072/hour per node (1 GB memory)

#### Monitoring and Logging
- **Custom metrics**: $0.30/metric-month (first 10,000 metrics free)
- **Dashboard**: $3.00/dashboard-month (first 3 free)
- **Log ingestion**: $0.50/GB
- **Log storage**: $0.03/GB-month

### Account Limits and Quotas

#### Instance Limits (per region)
| Resource | Default Limit | Notes |
|----------|---------------|-------|
| Running instances | 14 | Can be increased via support ticket |
| vCPU count | 112 | Based on 14 instances × 8 vCPU each |
| Elastic IPs | 5 | Additional available on request |
| Load balancers | 20 | Soft limit |

#### Requesting Increases
- **Standard increase**: 24-48 hour turnaround
- **Emergency increase**: 4-8 hour turnaround (requires business justification)
- **Permanent vs temporary**: Temporary increases valid for 30-90 days

### Cost Optimization Recommendations

1. **Reserved Instances**: Use for baseline capacity (60-70% of total)
2. **Auto Scaling**: Scale down during off-peak hours
3. **Right-sizing**: Monitor utilization and adjust instance types quarterly
4. **Storage lifecycle**: Move infrequently accessed data to cheaper tiers
5. **Data transfer**: Optimize CDN usage and compression

### Budget Planning Assumptions

- **Compute**: 65% of total infrastructure cost
- **Storage**: 15% of total infrastructure cost  
- **Data transfer**: 10% of total infrastructure cost
- **Managed services**: 10% of total infrastructure cost

---

*All prices are subject to change. Verify current pricing through the cloud provider's official pricing calculator before making final decisions.*

*Historical note: Previous pricing from 2023 had the medium instance at $0.42/hour. This rate has been reduced as part of our committed use discount program.*