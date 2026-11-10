# ADR-0005: Keep background jobs on one EC2 worker
Status: Accepted (2025-06-02), revisit when job count exceeds 5 or an outage occurs.
Decision: Run node-cron on one t3.small instance. Cheapest option at the time.
Consequences: Single point of failure. Accepted because jobs were non-critical.
