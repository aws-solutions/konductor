# Search incident summary: November 2024

On November 18, a bulk catalog import sent more requests than the cluster could accept. Rejected batches increased for nine minutes, while the gateway continued serving the previous index. The import was paused after the bulk rejection alert paged the on-call engineer.

The customer-facing impact was stale search data for eleven minutes. No requests returned an error because the alias was left on the healthy index. The follow-up added a rejected-batch alert, a visible indexer watermark, and an operating limit of 40 bulk requests per second. The limit is intended for the existing six-primary-shard layout and must be reviewed if shard count changes.

The incident review also recorded that an index switch should have a named previous index, a named operator, and a release record with the comparison evidence. The review did not change the public Search Gateway API.
