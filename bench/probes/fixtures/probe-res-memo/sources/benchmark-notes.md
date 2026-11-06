# Benchmark notes

Run 2025-03-18 on the same instance type for both queues, 1 KB messages.

| Queue | Sustained throughput | p99 latency |
|-------|----------------------|-------------|
| A | 5,000 messages a second per partition | 40 ms |
| B | 12,000 messages a second on the upgraded cluster | 25 ms |

Cost at 200 million messages a month: Queue A about 80, Queue B 1,200 (fixed).
