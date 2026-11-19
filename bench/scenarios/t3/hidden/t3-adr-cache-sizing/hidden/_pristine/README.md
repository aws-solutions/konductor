# Edge Cache Capacity Review

This fixture is the input packet for a capacity decision for the Northline edge-cache service. The service team is choosing a production cache shape for the next planning cycle. The files are intentionally split between service objectives, observed demand, node economics, and operational behavior.

Read the current requirements and traffic profile together. The small pilot values in the traffic profile describe a staging environment and are marked when they have been replaced. The price sheet is a monthly on-demand estimate in USD per node; it excludes application licensing because that cost is unchanged across the candidates.

The architecture shortlist in `candidate-configs.json` contains the shapes the platform team is willing to price. Benchmark rows describe one node handling its primary shard traffic. A replica is a second copy for availability, not an additional source of cache hit capacity for the primary copy.

The resulting architecture record belongs in `docs/adr/0001-cache.md`.
