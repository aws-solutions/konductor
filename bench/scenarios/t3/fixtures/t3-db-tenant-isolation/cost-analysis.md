# Storage Cost Analysis

## Current Cost Structure
Based on cloud provider pricing (see pricing.csv):

### Primary Cost Drivers:
1. **Storage**: $0.12 per GB-month
2. **Compute**: $0.048 per vCPU-hour
3. **Memory**: $0.008 per GB-hour
4. **Backups**: $0.02 per GB-month

## Budget Constraints
- **Total monthly budget**: $600 maximum
- **Storage allocation**: Must stay under budget after accounting for compute and other costs
- **Growth buffer**: 20% headroom required for unexpected growth

## Storage Calculations

### Row Size Analysis:
- Base ticket data: 185 bytes
- Index overhead: 125 bytes per row
- **Total per row**: 310 bytes

### Projected Storage Needs:
```
Year 1: 1.9 billion rows × 310 bytes = 589 GB
Year 2: 2.5 billion rows × 310 bytes = 775 GB
Year 3: 3.2 billion rows × 310 bytes = 992 GB
```

### Cost Projections (Storage Only):
```
Year 1: 589 GB × $0.12 = $70.68/month
Year 2: 775 GB × $0.12 = $93.00/month  
Year 3: 992 GB × $0.12 = $119.04/month
```

## Total Cost Considerations
Storage is only ~25% of total cost. Full cost breakdown:

| Component | Year 1 Cost | Year 2 Cost | Year 3 Cost |
|-----------|-------------|-------------|-------------|
| Storage   | $70.68      | $93.00      | $119.04     |
| Compute   | $240.00     | $315.00     | $403.20     |
| Memory    | $40.00      | $52.50      | $67.20      |
| Backup    | $14.14      | $18.60      | $23.81      |
| **Total** | **$364.82** | **$479.10** | **$613.25** |

*Note: Year 3 total slightly exceeds budget, requiring optimization*

## Index Cost Impact
Each additional index adds approximately:
- 45 bytes per row for B-tree indexes
- Additional IOPS during writes
- Increased backup storage

**Key constraint**: Storage-heavy approaches (like separate databases per tenant) may exceed budget due to index duplication overhead.