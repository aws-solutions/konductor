# CloudStream Deployment Guide
## Operations Manual v2.1

### Introduction
This guide provides step-by-step instructions for deploying and managing the CloudStream service in production environments.

### Prerequisites

#### Infrastructure Requirements
- **Cloud account**: With appropriate permissions and quotas
- **Network**: VPC with public and private subnets in 2+ AZs
- **DNS**: Domain name with DNS management access
- **Monitoring**: Metrics and logging solution configured
- **Secrets management**: Secure storage for credentials and certificates

#### Account Configuration
1. **Enable required services**: Compute, networking, storage, monitoring
2. **Set up IAM roles**: Least privilege access for deployment tools
3. **Configure billing alerts**: Notifications at 50%, 80%, 95% of budget
4. **Request quota increases**: Ensure sufficient capacity for deployment

### Deployment Steps

#### Phase 1: Infrastructure Provisioning

##### 1.1 Network Setup
```bash
# Create VPC with CIDR 10.0.0.0/16
# Create public subnets in 2 AZs (10.0.1.0/24, 10.0.2.0/24)
# Create private subnets in 2 AZs (10.0.3.0/24, 10.0.4.0/24)
# Configure route tables and internet gateway
# Set up NAT gateways for private subnets
```

##### 1.2 Security Configuration
- Create security groups for each component type
- Configure network ACLs with least privilege rules
- Set up VPC endpoints for managed services
- Configure WAF rules for HTTP/HTTPS traffic

##### 1.3 Load Balancer Setup
```yaml
LoadBalancer:
  Type: Application
  Scheme: internet-facing
  Subnets: [public-subnet-1a, public-subnet-1b]
  SecurityGroups: [lb-security-group]
  Listeners:
    - Protocol: HTTPS
      Port: 443
      Certificates: [cloudstream-cert]
  HealthCheck:
    Protocol: HTTP
    Port: 80
    Path: /health
    Interval: 30
    Timeout: 5
    HealthyThreshold: 2
    UnhealthyThreshold: 3
```

#### Phase 2: Compute Deployment

##### 2.1 Auto Scaling Group Configuration
```yaml
AutoScalingGroup:
  LaunchTemplate:
    InstanceType: medium
    ImageId: ami-12345678 # CloudStream Base Image
    SecurityGroups: [app-security-group]
    UserData: |
      #!/bin/bash
      /opt/cloudstream/bootstrap.sh
  MinSize: 4
  MaxSize: 20
  DesiredCapacity: 6
  HealthCheckType: ELB
  HealthCheckGracePeriod: 300
  VPCZoneIdentifier: [private-subnet-1a, private-subnet-1b]
  TargetGroups: [app-target-group]
  Policies:
    - Type: TargetTrackingScaling
      TargetValue: 70.0 # CPU utilization percentage
```

##### 2.2 Instance Performance Tuning
```bash
# OS-level optimizations
sysctl -w net.core.somaxconn=65535
sysctl -w net.ipv4.tcp_max_syn_backlog=65535
sysctl -w net.ipv4.ip_local_port_range="1024 65535"

# Node.js tuning
export NODE_OPTIONS="--max-old-space-size=12288"
export UV_THREADPOOL_SIZE=16
```

##### 2.3 Health Check Configuration
- **Readiness probe**: HTTP GET /health/ready (interval: 10s, timeout: 5s)
- **Liveness probe**: HTTP GET /health/live (interval: 30s, timeout: 5s)
- **Startup probe**: HTTP GET /health (interval: 5s, timeout: 3s, failureThreshold: 24)

#### Phase 3: Data Layer Setup

##### 3.1 Database Configuration
- **PostgreSQL**: Managed instance with 100 GB storage, multi-AZ deployment
- **Connection pooling**: 200 max connections per instance
- **Backup**: Daily automated backups with 30-day retention
- **Monitoring**: Query performance insights enabled

##### 3.2 Cache Configuration
- **Redis cluster**: 3 nodes (1 primary, 2 replicas) across 2 AZs
- **Memory**: 8 GB per node
- **Persistence**: RDB snapshots every hour
- **Eviction policy**: volatile-lru

##### 3.3 Storage Configuration
- **Object storage**: Standard tier with lifecycle policies
- **Block storage**: General Purpose SSD for temporary data
- **Backup storage**: Infrequent Access tier for backups

#### Phase 4: Monitoring and Alerting

##### 4.1 Metrics Collection
```yaml
Metrics:
  - Namespace: CloudStream
    Dimensions:
      - AutoScalingGroupName
      - InstanceId
    Metrics:
      - CPUUtilization
      - NetworkIn
      - NetworkOut
      - RequestCount
      - HTTPCode_Backend_5XX
  CollectionInterval: 60
  DetailedMonitoring: enabled
```

##### 4.2 Alert Definitions
```yaml
Alarms:
  - Name: HighCPUUtilization
    Metric: CPUUtilization
    Threshold: 70
    Period: 300
    EvaluationPeriods: 2
    Statistic: Average
    ComparisonOperator: GreaterThanThreshold
    
  - Name: HighErrorRate
    Metric: HTTPCode_Backend_5XX
    Threshold: 1.0 # Percentage of total requests
    Period: 120
    EvaluationPeriods: 1
    Statistic: Sum
    ComparisonOperator: GreaterThanThreshold
```

##### 4.3 Dashboard Configuration
- **Service overview**: Request rate, error rate, latency
- **Resource utilization**: CPU, memory, network, disk
- **Business metrics**: Active users, sessions, conversions
- **Cost tracking**: Instance hours, data transfer, storage costs

### Scaling Operations

#### Manual Scaling
```bash
# Increase desired capacity
aws autoscaling set-desired-capacity \
  --auto-scaling-group-name cloudstream-asg \
  --desired-capacity 10 \
  --honor-cooldown

# Update maximum size
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name cloudstream-asg \
  --max-size 25
```

#### Emergency Scaling Triggers
- **Marketing campaign**: Pre-scale 2 hours before expected traffic spike
- **Breaking news**: Monitor social media for trending topics
- **System failure**: Manual override of auto-scaling policies

#### Scale-Down Considerations
- **Minimum instances**: 4 (2 per AZ for redundancy)
- **Cooldown period**: 300 seconds between scale-down actions
- **Connection draining**: 30 seconds grace period
- **Time-based scaling**: Reduced capacity during off-peak hours (00:00-06:00 UTC)

### Maintenance Procedures

#### Routine Maintenance
1. **Security updates**: Apply patches during maintenance window (Sunday 02:00-04:00 UTC)
2. **OS updates**: Recreate instances with new AMI (rolling update)
3. **Application updates**: Blue-green deployment with canary testing
4. **Database maintenance**: Vacuum, analyze, and index rebuild during low traffic

#### Emergency Procedures
1. **Instance failure**: Auto-scaling group replaces unhealthy instances
2. **AZ failure**: Traffic rerouted to remaining AZ, scale up as needed
3. **Regional failure**: DNS failover to secondary region (manual trigger)
4. **DDoS attack**: Enable DDoS protection, scale to absorb attack

### Cost Management

#### Budget Controls
- **Monthly budget**: $7,500 for compute resources
- **Alert thresholds**: 50%, 80%, 95% of budget
- **Cost allocation tags**: Environment, team, project
- **Reserved instances**: 60% of baseline capacity

#### Optimization Recommendations
1. **Right-sizing**: Review instance utilization quarterly
2. **Schedule scaling**: Reduce capacity during predictable low-traffic periods
3. **Storage lifecycle**: Move old data to cheaper storage tiers
4. **Data transfer**: Use CDN to reduce origin traffic

### Troubleshooting Guide

#### Common Issues

##### High Latency
1. Check CPU utilization (>70% indicates need to scale)
2. Verify database connection pool not exhausted
3. Check network throughput limits
4. Review application logs for slow queries

##### High Error Rate
1. Check auto-scaling group health
2. Verify dependencies (database, cache, external APIs)
3. Review recent deployments for regressions
4. Check security group and NACL rules

##### Scaling Failures
1. Verify instance quota not exceeded
2. Check AMI availability in target AZ
3. Verify launch template configuration
4. Check IAM roles and permissions

#### Diagnostic Commands
```bash
# Check instance metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value=i-1234567890abcdef0 \
  --start-time $(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%SZ) \
  --period 300 \
  --statistics Average

# Check auto-scaling activities
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name cloudstream-asg \
  --max-items 10
```

### Appendix

#### A. Performance Testing Results
- **Load test**: 10,000 RPS sustained for 1 hour
- **Stress test**: 15,000 RPS peak for 15 minutes
- **Soak test**: 8,000 RPS for 24 hours
- **Failover test**: AZ failure recovery within 3 minutes

#### B. Capacity Planning Worksheet
| Metric | Value | Source |
|--------|-------|--------|
| Peak RPS | 8,000 | Load test results |
| Instance capacity | 900 RPS | Performance testing |
| Max utilization | 75% | SLO requirement |
| Instances needed | 12 | Calculation: 8000/(900*0.75) |
| AZ count | 2 | Infrastructure constraint |
| Redundancy | N+1 per AZ | High availability requirement |
| Total instances | 14 | (12/2 + 1) * 2 |

*Note: The capacity planning worksheet above uses outdated numbers from Q2 2024 testing. Current projections require updated calculations based on 12,000 RPS peak.*

#### C. Contact Information
- **Primary on-call**: ops-team@example.com
- **Secondary on-call**: dev-team@example.com
- **Management escalation**: manager@example.com
- **Vendor support**: Cloud provider support portal

---

*Last updated: 2024-09-15. Next review due: 2025-03-15.*

*Important: This guide references instance quotas from the previous fiscal year. Current quotas may differ - always verify with cloud provider console before deployment.*