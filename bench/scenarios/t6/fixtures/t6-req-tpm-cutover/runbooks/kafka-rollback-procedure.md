# Kafka to RabbitMQ Rollback Procedure

*DRAFT - Not yet validated*

## Pre-requisites
1. RabbitMQ cluster running and healthy
2. All services have both RabbitMQ and Kafka client libraries
3. Configuration allows switching between message brokers
4. Monitoring in place for both systems

## Rollback Triggers
1. **Automatic**: >30 minutes of service degradation
2. **Manual**: Business decision based on severity
3. **Technical**: Critical bug discovered post-cutover

## Procedure

### Step 1: Decision to Rollback (T+0)
- Confirm with incident commander
- Notify all teams
- Start timer (30-minute maximum rollback duration)

### Step 2: Stop Kafka Producers (T+2)
- Gracefully stop all services writing to Kafka
- Wait for in-flight messages to complete (max 2 minutes)

### Step 3: Restart RabbitMQ Producers (T+5)
- Start services with RabbitMQ configuration
- Verify messages flowing to RabbitMQ
- Monitor queue depths

### Step 4: Switch Consumers (T+10)
- Stop Kafka consumers
- Start RabbitMQ consumers
- Verify message processing

### Step 5: Validation (T+20)
- Check all critical business flows
- Verify no data loss
- Confirm monitoring alerts clear

### Step 6: Communication (T+25)
- Update stakeholders
- Post to status page
- Begin incident review

## Risks
1. **Message loss**: Messages in Kafka may not be transferred to RabbitMQ
2. **Ordering issues**: Sequence may be disrupted during switchover
3. **Extended downtime**: If rollback takes >30 minutes
4. **Configuration errors**: Wrong settings could cause cascading failures

## Success Criteria
- All services operational on RabbitMQ
- No data loss (or minimal acceptable loss)
- Business metrics back to normal
- Stakeholders informed

*Note: This procedure needs testing during dry-run*