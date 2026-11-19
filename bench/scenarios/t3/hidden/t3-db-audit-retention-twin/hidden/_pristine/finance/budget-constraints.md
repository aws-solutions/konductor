# Budget Constraints for Audit Log System

## Fiscal Year 2024-2025 Allocation

### Capital Expenditure (CapEx)
- **Initial infrastructure**: $250,000 (one-time)
- **Hardware refresh**: $50,000/year (starting year 3)

### Operational Expenditure (OpEx)
**Monthly operational budget**:
- Compute resources: $8,000/month
- **Storage resources**: $7,000/month (hard limit)
- Network egress: $1,500/month
- Monitoring & management: $500/month

**Total monthly OpEx limit**: $17,000/month

### Storage-Specific Constraints
- **Maximum storage capacity**: 300 TB (technical limit)
- **Cost target**: ≤ $0.025/GB-month (based on standard tier pricing)
- **Growth buffer**: 20% capacity headroom required

### Compliance Budget
- External audit support: $15,000/year
- Compliance tooling: $5,000/month
- Legal review retainers: $10,000/year

### Notes on Legacy Documentation
**Important**: The legacy compliance manual references a 90-day retention policy. This has been superseded by the 400-day requirement documented in `requirements/compliance.md`. Budget calculations must use the current 400-day policy.

### Cost Optimization Goals
1. Achieve storage cost ≤ $6,500/month for primary storage
2. Archive older data (>180 days) to lower-cost tier if possible
3. Use compression where feasible without impacting query performance
4. Consider data tiering strategies for cost optimization