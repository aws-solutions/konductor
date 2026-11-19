# Traffic Analysis for Report Export Feature

## Current Usage Patterns (Based on Similar Features)

### Monthly Volume Forecast
- **Total reports per month**: 500,000 (projected)
- **Peak hour volume**: 8,000 reports/hour
- **Average report size distribution**:
  - Small reports (< 100k rows): 85% of volume
  - Medium reports (100k-1M rows): 14% of volume
  - Large reports (1M-3M rows): 0.9% of volume
  - Extra large reports (> 3M rows): 0.1% of volume

### Size Distribution Analysis
Based on 90 days of similar query patterns in our analytics system:

| Percentile | Rows | Frequency |
|------------|------|-----------|
| 50th (median) | 45,000 | 50% of reports |
| 75th | 180,000 | 25% of reports |
| 90th | 850,000 | 10% of reports |
| **95th** | **2,300,000** | **5% of reports** |
| **99th** | **6,800,000** | **1% of reports** |
| 99.9th | 9,500,000 | 0.1% of reports |

### Time of Day Patterns
- Peak usage: 10:00-15:00 UTC (business hours)
- Low usage: 22:00-06:00 UTC
- Weekend usage: 40% of weekday average

## Performance Benchmarks

### Current System Capabilities
- **API Gateway timeout**: 29 seconds (hard limit, cannot be increased)
- **Lambda maximum duration**: 900 seconds (15 minutes)
- **Database query timeout**: 60 seconds
- **Network egress bandwidth**: 10 Gbps

### Report Generation Performance
Testing with current prototype shows:
- **Rendering time**: 0.4 seconds per 100,000 rows
- **Data serialization**: 0.1 seconds per 100,000 rows  
- **Network upload overhead**: Variable based on client connection

**Note**: Legacy testing from Q4 2023 showed 0.5 seconds per 100k rows, but recent optimizations have improved this to 0.4 seconds. The 0.5s figure is superseded by current measurements.

### Estimated Processing Times
| Report Size | Render Time | Upload Time | Total Time |
|-------------|-------------|-------------|------------|
| 50,000 rows | 0.2s | 0.05s | **0.25s** |
| 500,000 rows | 2.0s | 0.5s | **2.5s** |
| 2,300,000 rows | 9.2s | 2.3s | **11.5s** |
| 6,800,000 rows | 27.2s | 6.8s | **34.0s** |

**Critical Finding**: The 99th percentile report (6.8M rows) at 34.0 seconds exceeds the API Gateway timeout of 29 seconds. This affects approximately 5,000 reports per month (1% of 500,000).

## User Expectations Survey
- 90% of users expect exports under 10 seconds
- 95% of users will wait up to 30 seconds for large reports
- 99% of users will accept async delivery for reports > 30 seconds
- Most users prefer immediate download over email delivery (70% vs 30%)

## Infrastructure Considerations
- Current API Gateway configuration supports 10,000 requests per second
- Lambda concurrency limit: 1,000 concurrent executions
- S3 bucket can handle 3,500 PUT requests per second
- Database can sustain 5,000 concurrent queries

## Risk Assessment
**High Risk**: Synchronous exports for 99th percentile reports will fail due to timeout.
**Medium Risk**: Cost overruns if usage exceeds projections by 50%+.
**Low Risk**: Infrastructure scaling for average case.