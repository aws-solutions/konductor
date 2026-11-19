# Deployment Guide

## Rolling Deployment Strategy

Our deployment process uses a blue-green approach with these characteristics:

### Key Constraints
- **Old and new code run simultaneously** during the transition period (5-10 minutes)
- **Database schema changes must be backward compatible** during this window
- **New columns must be nullable or have defaults** to avoid breaking old code
- **Data migrations must be incremental** to avoid performance issues

### Production Environment
- **Orders table size**: 2.5 million rows and growing
- **Peak load**: ~500 orders/minute during business hours
- **Deployment window**: Tuesday/Thursday 2-4 AM local time
- **Rollback timeout**: 15 minutes maximum

### Migration Safety Rules
1. **NOT NULL columns**: Must have DEFAULT values when added
2. **Column removal**: Must wait 2 deployment cycles before actual removal
3. **Index creation**: Should use CONCURRENT creation where supported
4. **Data backfills**: Must be batched (max 10k rows per transaction)
5. **Column type changes**: Require 3-step process (add new, copy, drop old)

### Monitoring
During deployments, monitor:
- Database connection errors
- Query timeout rates
- Application error rates
- Migration progress indicators