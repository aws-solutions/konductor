# Operating model

The cache engine reserves a quarter of each node's advertised memory for indexes, runtime state, and compaction. The remaining memory is available to the primary copy on that node. The reservation is applied before comparing a node with the working set.

The production topology keeps one replica for each primary shard. A replicated shard has no expected data-loss window during a single-node failure and normally completes promotion in three minutes. A non-replicated shard has a 20-minute recovery-point window and takes twelve minutes to restore from the source service. These are operational estimates for the current engine release.

| Operating fact | Value | Unit |
| --- | ---: | --- |
| Engine memory reservation | 25 | percent of advertised memory |
| RPO with a replica | 0 | minutes |
| RTO with a replica | 3 | minutes |
| RPO without a replica | 20 | minutes |
| RTO without a replica | 12 | minutes |
