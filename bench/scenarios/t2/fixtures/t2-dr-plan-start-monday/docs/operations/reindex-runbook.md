# Reindex operating notes

The reindex job reads the catalog export from object storage and writes batches to a physical index. It records a source watermark and a document count for each batch. A completed job can be resumed from the last recorded watermark. The job does not create synonym files; those come from the catalog dictionary release process.

Before a new physical index is made visible, the operator checks shard health, document count, rejected bulk requests, and the watermark age. The operator keeps the old physical index for at least seven days after the alias change. Deleting an old index requires a release record and an approval from Search Gateway on-call.

An alias change is a single control-plane operation. The runbook's normal recovery action is to point `catalog-search-live` back to the previous physical index and then record the time and reason. The operator must know the previous and new physical names before making the change. If the cluster is unhealthy, the operator pauses the job and asks the release manager to reschedule the window.

For a traffic change, the operator watches gateway error rate, p95 latency, empty-result rate, facet mismatch rate, and indexer watermark age. The dashboard has seven-day history, and the alert rules page Search Gateway on-call when error rate or latency crosses the service target for five minutes.
