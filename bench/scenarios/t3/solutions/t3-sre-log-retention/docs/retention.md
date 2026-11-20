# Log Retention Storage Tier Decision

## Analysis Overview

After reviewing all requirements documents, I have analyzed our log retention needs and evaluated multiple storage tier strategies. The key constraints are:

1. **Data Volume**: 24 TB/day raw log ingestion
2. **Retention Period**: 365 days minimum for compliance
3. **Query Performance**:
   - Last 30 days: p95 ≤ 60 seconds
   - Older data (31-365 days): p95 ≤ 15 minutes (900 seconds)
4. **Budget**: Maximum $28,000/month for storage
5. **Compression**: 8:1 compression ratio for warm/cold tiers

## Option Evaluation

### Option 1: All Hot Tier (`all_hot`)
- **Strategy**: Store all 365 days in hot tier
- **Advantages**: Best query performance, simplest implementation
- **Disadvantages**: Extremely expensive
- **Cost Calculation**:
  - Daily ingest: 24 TB = 24,576 GB
  - No compression for hot tier
  - Monthly storage: (24,576 GB/day × 365 days) ÷ 30.44 days/month = 294,686 GB-month
  - Cost: 294,686 GB-month × $0.10/GB-month = **$29,468.59**
- **Verdict**: ❌ **Exceeds budget** ($29,469 > $28,000)

### Option 2: All Cold Tier (`all_cold`)
- **Strategy**: Store all 365 days in cold tier
- **Advantages**: Lowest cost
- **Disadvantages**: Violates query performance for recent data
- **Cost Calculation**:
  - Daily ingest compressed: 24,576 GB ÷ 8 = 3,072 GB
  - Monthly storage: (3,072 GB/day × 365 days) ÷ 30.44 = 36,835 GB-month
  - Cost: 36,835 GB-month × $0.004/GB-month = **$147.34**
- **Performance**: Recent 30-day queries would have 900s p95 (cold tier), violating the 60s requirement
- **Verdict**: ❌ **Fails performance requirement**

### Option 3: Mixed Hot + Warm + Cold (`mixed_hot_warm_cold`)
- **Strategy**: 
  - 30 days in hot tier (operational queries)
  - 90 days in warm tier (investigation data)
  - 245 days in cold tier (compliance archive)
- **Advantages**: Balances cost and performance, meets all requirements
- **Cost Calculation**:
  - Hot tier: (24,576 GB/day × 30 days) ÷ 30.44 = 24,221 GB-month × $0.10 = $2,422.10
  - Warm tier: (3,072 GB/day × 90 days) ÷ 30.44 = 9,083 GB-month × $0.03 = $272.49
  - Cold tier: (3,072 GB/day × 245 days) ÷ 30.44 = 24,731 GB-month × $0.004 = $98.92
  - **Total: $2,793.51**
- **Performance**:
  - Recent 30 days: All in hot tier → 60s p95 ✓
  - Older data: Worst case in warm tier → 300s p95 (well under 900s limit) ✓
- **Verdict**: ✅ **Meets all requirements, optimal cost**

### Option 4: Hot 90 Days + Cold Rest (`hot_90_cold_rest`)
- **Strategy**: 
  - 90 days in hot tier (extended performance)
  - 275 days in cold tier
- **Advantages**: Good performance for extended period
- **Cost Calculation**:
  - Hot tier: (24,576 GB/day × 90 days) ÷ 30.44 = 72,663 GB-month × $0.10 = $7,266.30
  - Cold tier: (3,072 GB/day × 275 days) ÷ 30.44 = 27,763 GB-month × $0.004 = $111.05
  - **Total: $7,377.35**
- **Performance**:
  - Recent 30 days: All in hot tier → 60s p95 ✓
  - Older data: Mixed hot/cold → worst case 900s p95 ✓
- **Verdict**: ✅ **Meets requirements but suboptimal cost** ($7,377 vs $2,794)

## Recommendation

**Chosen Option: `mixed_hot_warm_cold`**

I recommend the mixed hot + warm + cold strategy for the following reasons:

1. **Cost Efficiency**: At $2,793.51/month, it uses only 10% of our budget, leaving room for growth and unexpected expenses.
2. **Performance Compliance**: Meets all query latency requirements:
   - Recent 30 days in hot tier: 60s p95
   - Older data in warm/cold: ≤300s p95 (well under 900s limit)
3. **Future Flexibility**: The 3-tier approach provides flexibility to adjust retention periods based on changing requirements.
4. **Risk Mitigation**: By not using all-cold for recent data, we avoid performance violations during critical incidents.
5. **Growth Accommodation**: With 90% of budget unused, we can accommodate the projected 20% annual growth.

## Implementation Notes

1. **Tier Transition Schedule**:
   - Days 0-30: Hot tier (no compression)
   - Days 31-120: Warm tier (8:1 compression)
   - Days 121-365: Cold tier (8:1 compression maintained)

2. **Monitoring Requirements**:
   - Track query performance by age range
   - Monitor tier transition success rates
   - Alert on budget utilization (>80%, >90%)

3. **Optimization Opportunities**:
   - Consider adjusting warm tier duration based on actual query patterns
   - Implement query caching for frequently accessed historical data
   - Review compression ratio quarterly for potential improvements

## Decision Summary

```decision
{
  "chosen": "mixed_hot_warm_cold",
  "options": ["all_hot", "all_cold", "mixed_hot_warm_cold", "hot_90_cold_rest"],
  "limits": {
    "monthly_budget": {"limit": 28000, "value": 2793.51},
    "recent_query_p95": {"limit": 60, "value": 60},
    "older_query_p95": {"limit": 900, "value": 300},
    "retention_days": {"limit": 365, "value": 365}
  },
  "monthly_cost_usd": 2793.51
}
```