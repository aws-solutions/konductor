# Proposal: migrate order events from SQS to Kafka

## Justification

**J1. Industry direction.** Every major tech company runs Kafka. Netflix, LinkedIn and Uber all use it, so it is clearly the right choice for us too.

**J2. Now or never.** Either we migrate to Kafka this quarter, or we accept that the order pipeline will never scale past its current load.

**J3. Proven in our own test.** Last month we ran a 20-minute spike test on a single Kafka broker at 2x current peak (4,000 events/s, measured in the load-test report LT-17, attached). p99 end-to-end latency was 38 ms versus 210 ms on SQS in the same harness. Because order volume has grown 2x per year for three years (finance dashboard), we expect to hit 4,000 events/s within 12 months, so Kafka's headroom covers at least the next year. This holds only if the broker cluster is sized for 3x replication; LT-17 used replication factor 1, so production numbers may be worse.

**J4. Expert endorsement.** Our principal engineer said in the hallway that SQS is "a toy" for event streaming, so we should not keep using it.
