# RabbitMQ Order Processing Runbook

## System Overview
- **Cluster**: 3-node RabbitMQ 3.8.12
- **Nodes**: t3.large EC2 instances
- **Location**: us-east-1a, us-east-1b, us-east-1c
- **Queues**: 14 active queues for order processing
- **Throughput**: ~5,000 msg/sec peak, ~1,200 msg/sec average

## Monitoring
- **Dashboard**: Grafana #rabbitmq-production
- **Critical Alerts**:
  - Queue depth > 10,000
  - Consumer lag > 30 seconds
  - Node memory > 85%
  - Disk space < 20%

## Common Operations

### Restart Sequence
1. Drain traffic from node (wait 2 minutes)
2. Stop RabbitMQ service: `systemctl stop rabbitmq-server`
3. Wait 30 seconds
4. Start: `systemctl start rabbitmq-server`
5. Verify: `rabbitmqctl status`
6. Re-enable traffic

### Queue Management
```bash
# List queues
rabbitmqctl list_queues name messages_ready

# Purge queue (emergency only)
rabbitmqctl purge_queue order_queue

# Move messages (manual)
# Use shovel plugin - takes ~2 hours for 1M messages
```

### Backup/Restore
- **Backup**: Nightly to S3 (config + definitions only)
- **Message Recovery**: Not supported - messages are transient
- **Restore Time**: 45 minutes for full cluster

## Failure Scenarios

### Single Node Failure
1. Automatic failover to other nodes
2. Alert triggers
3. Replace node within 4 hours
4. No data loss (mirrored queues)

### Network Partition
1. Detect via `rabbitmqctl cluster_status`
2. Manual intervention required
3. May require restart with `--ignore-alarms`
4. Potential message loss in edge cases

### Disk Full
1. Stop accepting new messages
2. Emergency purge of oldest queues
3. Expand EBS volume
4. Restart service

## Performance Limits
- **Max connections**: 5,000 per node
- **Max queues**: 500 per vhost
- **Message size**: 50MB max (recommend < 1MB)
- **Retention**: Messages expire after 7 days in dead letter
- **Ordering**: FIFO within single queue only

## On-Call Contacts
- **Primary**: Platform team pager
- **Secondary**: Alex Rodriguez (x2345)
- **Escalation**: Maya Chen (x1234)

## Known Issues
1. Memory leaks after 30+ days uptime - requires restart
2. Shovel plugin slow for large queues
3. TLS performance overhead (~15%)
4. Monitoring gaps for consumer lag