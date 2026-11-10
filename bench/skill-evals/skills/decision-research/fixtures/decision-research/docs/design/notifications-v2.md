# Notifications v2 (draft)

## Background
1. There is no retry utility in the codebase today, so every job hand-rolls its retries. v2 adds one.
2. SQS FIFO queues have unlimited throughput, so we can move the digest fan-out to a FIFO queue with no batching concerns.
3. The cron worker has never had an outage.
4. We send roughly 40k digest emails per day.

## Proposal
Replace SNS with an SQS FIFO queue per provider and add a new retry library.
