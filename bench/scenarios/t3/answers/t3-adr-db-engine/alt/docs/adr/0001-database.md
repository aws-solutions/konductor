# ADR 0001: Select the session-store database

* **Status:** Accepted
* **Date:** 2025-02-14

## Consequences: notes

Provisioned capacity costs more than on-demand during the average month, but it provides a controlled launch capacity window and an explicit hot-key write-distribution strategy. The application must route writes for hot logical keys through the two configured shards and read through the corresponding fan-in path. Autoscaling alarms should cover write utilization and shard skew, and a launch rehearsal should verify that the measured p99 remains within 15 ms.

The design should be revisited if item size, hot-key concentration, or the launch rate changes. Cost estimates exclude application compute, network transfer, and engineering labor, as specified by the internal price sheet.

## Decision: notes

Choose `kv-provisioned-autoscaling` with two write-distribution shards for each hot partition group. The two shards spread the 15,000 hot writes per second across 16 effective write destinations, or 937.5 WCU per destination. That is below the 1,000 WCU partition ceiling while retaining enough peak capacity for 30,000 writes per second.

The estimated monthly cost is USD 6,540. The estimate is 3,000 WCU for 700 hours plus 30,000 WCU for 30 launch hours at the provisioned WCU rate, 5,000 RCU for 730 hours, and USD 45 for storage and backups. The computed read p99 is 11 ms, RPO is 45 seconds, and RTO is 240 seconds.

```decision
{
    "monthly_cost_usd": 6540,
    "limits": {
        "partition_write_wcu": {
            "value": 937.5,
            "limit": 1000
        },
        "rto_seconds": {
            "value": 240,
            "limit": 300
        },
        "rpo_seconds": {
            "value": 45,
            "limit": 60
        },
        "item_size_bytes": {
            "value": 1024,
            "limit": 1024
        },
        "monthly_budget_usd": {
            "value": 6540,
            "limit": 7000
        },
        "read_p99_ms": {
            "value": 11,
            "limit": 15
        },
        "peak_write_wps": {
            "value": 30000,
            "limit": 25000
        }
    },
    "options": [
        "kv-on-demand",
        "kv-provisioned-autoscaling",
        "relational-cluster"
    ],
    "chosen": "kv-provisioned-autoscaling"
}
```

### Relational cluster: notes

The relational cluster has the best estimated read p99 at 8 ms and a 40,000-write-per-second capacity. Its four-node monthly estimate is USD 8,075, which exceeds the USD 7,000 database budget. It also adds operational complexity that is not needed for the session access pattern.

### Key-value table on-demand: notes

On-demand billing is the least expensive estimate at USD 4,964.616 per month, and its projected read p99, recovery values, and total peak write capacity fit the other objectives. It is rejected because the hot write rate is 15,000 / 8 = 1,875 WCU per storage partition without write distribution, exceeding the 1,000 WCU service ceiling. Lower average billing cannot compensate for a launch-day capacity failure.

## Alternatives considered: notes

## Context: notes

The launch profile peaks at 25,000 writes per second. The average month is 1,800 writes and 3,600 reads per second, with 1,024-byte items. The top 2% of 10,000 logical keys are 200 hot keys and receive 60% of peak writes. The current allocator places those hot keys across eight storage partitions. The service objectives are a read p99 of at most 15 ms, a monthly database cost of at most USD 7,000, an RPO of at most 60 seconds, and an RTO of at most 300 seconds. A key-value storage partition accepts at most 1,000 WCU per second.
