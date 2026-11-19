# Architecture Overview: Nightly Reporting Pipeline

## Current System Architecture

### High-Level Design
```
[Source DBs] → [CDC Capture] → [S3 Raw] → [Spark Batch] → [S3 Processed] → [BI Tools]
```

### Component Details

#### 1. Data Sources
- **Primary Database**: MySQL 8.0 (transactions)
- **Secondary Databases**: PostgreSQL 14 (user profiles, inventory)
- **External Sources**: Payment gateways, shipping providers
- **Data Volume**: 1.4 TB daily (compressed Parquet)

#### 2. Capture Layer
- **Tool**: Debezium 2.3
- **Format**: Avro schemas in Schema Registry
- **Frequency**: Continuous CDC streams
- **Buffer**: Kafka topics (7-day retention)

#### 3. Storage Layer
- **Raw Storage**: S3 (`s3://transactions-raw/`)
  - Retention: 30 days
  - Format: Parquet with Snappy compression
  - Partition: `year/month/day/hour/`

- **Processed Storage**: S3 (`s3://reports-processed/`)
  - Retention: 90 days
  - Format: Parquet + CSV summaries
  - Partition: `report_type/year/month/day/`

#### 4. Processing Layer
- **Framework**: Apache Spark 3.4.1
- **Cluster**: EMR 6.9
  - Master: m5.4xlarge (16 vCPU, 64GB)
  - Workers: 8 × m5.2xlarge (8 vCPU, 32GB each)
  - Total: 72 vCPU, 320GB RAM

- **Job Configuration**:
  ```json
  {
    "executor_instances": 8,
    "executor_cores": 4,
    "executor_memory": "28g",
    "driver_memory": "16g",
    "max_retries": 3
  }
  ```

#### 5. Delivery Layer
- **BI Integration**: Athena tables, Glue Catalog
- **Notification**: SNS topics for job completion
- **Monitoring**: CloudWatch metrics and dashboards

## Performance Characteristics

### Current Metrics
- **Throughput**: 667 GB/hour (1.4 TB in 2.1 hours)
- **Cost Efficiency**: $3.08/GB processed
- **Resource Utilization**: 65% CPU, 80% memory
- **Network**: 2.5 Gbps average during processing

### Scaling Behavior
- **Linear Scaling**: Processing time scales linearly with data volume
- **Current Limit**: ~2.5 TB in 4 hours with current cluster
- **Bottleneck**: Network throughput between S3 and EMR

### Reliability Metrics
- **Uptime**: 99.7% (last 90 days)
- **Job Success Rate**: 98.5%
- **Mean Time To Recovery**: 45 minutes
- **Data Loss**: 0.001% (within SLA)

## Constraints and Limitations

### Hard Constraints
1. **Processing Window**: 4 hours maximum (2:00 AM - 6:00 AM)
2. **Budget**: $10,000 monthly maximum
3. **RPO**: 1 hour maximum data loss
4. **RTO**: 2 hours maximum downtime

### Technical Limitations
1. **Current Cluster Capacity**: Cannot process >2.5 TB within 4 hours
2. **Storage Costs**: Growing at 35% quarterly
3. **Network Limits**: 5 Gbps maximum from S3
4. **Memory Constraints**: 32GB per executor limits window operations

### Operational Limitations
1. **Startup Time**: 15 minutes for cluster provisioning
2. **Warm-up**: 10 minutes for JVM/JIT optimization
3. **Cleanup**: 5 minutes for resource termination
4. **Monitoring Gap**: 5-minute CloudWatch delay

## Future Considerations

### Growth Projections
- Q4 2024: 1.89 TB (within current capacity)
- Q1 2025: 2.55 TB (near capacity limit)
- Q2 2025: 3.44 TB (exceeds capacity)
- Q3 2025: 4.65 TB (requires architectural change)

### Architectural Options
1. **Scale Batch**: Larger/more cluster nodes
2. **Optimize Processing**: Better algorithms/compression
3. **Streaming Architecture**: Near-real-time processing
4. **Hybrid Approach**: Batch for history, streaming for recent

### Risk Assessment
- **High Risk**: Exceeding 4-hour window by Q2 2025
- **Medium Risk**: Cost overruns with scaling
- **Low Risk**: Technology obsolescence
- **Mitigation**: Quarterly architecture reviews

## Dependencies

### AWS Services
- EMR, S3, CloudWatch, IAM, Lambda, SNS, Athena, Glue

### Third-Party Tools
- Debezium, Kafka, Schema Registry
- Tableau, Looker (BI consumption)

### Internal Systems
- CI/CD pipeline (Jenkins)
- Configuration management (Ansible)
- Secret management (Vault)

**Note**: The 2.5 TB processing limit assumes optimal network conditions. During peak hours or regional issues, this may reduce to 2.0 TB. Always include 20% safety margin in capacity planning.