# Search API service map

The edge gateway accepts HTTPS requests and forwards them to eight `search-api` containers. Each API container reads the read-only shard index and sends refresh work to `indexer`. `node-agent` records process and cgroup readings. The gateway retries one failed upstream request once.

The container memory limit is 2048 MiB. Health checks run every 30 seconds and do not exercise the full query path. Container names are `search-01` through `search-08`.
