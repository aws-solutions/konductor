# Operating assumptions

The on-call team can deploy an extra regional queue without changing the notification contract. Recovery automation snapshots consumer offsets every 30 seconds for the regional design and every 20 seconds for the partitioned design. The single-queue pool retains messages for 45 seconds before its recovery point is considered exceeded.

Workers are spread across three availability zones. The counts in `options.json` are the steady-state counts for the monthly estimate. A worker can process one delivery lane at a time; adding workers does not increase the managed queue's per-queue ingress quota.

The review is for an architecture decision, so the selected design should identify its components and explain its cost and operational tradeoffs. It does not need deployment manifests or application code.
