# Queue B (self-run broker)

Collected 2023-02-20. Latency and throughput in this note are superseded by `benchmark-notes.md` (2025-03).

- Latency at p99: 60 ms.
- Throughput: 4,000 messages a second on the old cluster.
- Price: a fixed 1,200 a month for a three-node cluster, whatever the volume.
- Ordering: global ordering inside one topic.
- Retention: set by the team.
- Operations: the team patches and upgrades the cluster.
