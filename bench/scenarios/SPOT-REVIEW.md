# Spot-review sample

The owner reads these tasks before any task of their batch is locked (plan section 8a). Drawn by `node bench/runner/bench.js scenarios spot-review --seed 20261119`:
per batch a shuffle with its own seed (the base seed plus the batch number) of the sorted task ids, dropped tasks left out, then the first 10%, rounded up, and at least one.
`spot-review.json` pins the samples the owner has already read and marks the batches that are not final yet. Redraw a batch only when it gains or loses tasks, and say so in the commit.

| batch | task | task file | fixture | hidden checks | reference |
| --- | --- | --- | --- | --- | --- |
| t1 | t1-bug-cache-ttl | [t1-bug-cache-ttl.json](t1/t1-bug-cache-ttl.json) | [fixtures](t1/fixtures/t1-bug-cache-ttl/) | [hidden](t1/hidden/t1-bug-cache-ttl/) | [solution](t1/solutions/t1-bug-cache-ttl/) |
| t1 | t1-bug-event-listeners | [t1-bug-event-listeners.json](t1/t1-bug-event-listeners.json) | [fixtures](t1/fixtures/t1-bug-event-listeners/) | [hidden](t1/hidden/t1-bug-event-listeners/) | [solution](t1/solutions/t1-bug-event-listeners/) |
| t1 | t1-impl-job-retry | [t1-impl-job-retry.json](t1/t1-impl-job-retry.json) | [fixtures](t1/fixtures/t1-impl-job-retry/) | [hidden](t1/hidden/t1-impl-job-retry/) | [solution](t1/solutions/t1-impl-job-retry/) |
| t2 | t2-arch-dr-two-regions (pinned) | [t2-arch-dr-two-regions.json](t2/t2-arch-dr-two-regions.json) | [fixtures](t2/fixtures/t2-arch-dr-two-regions/) | [hidden](t2/hidden/t2-arch-dr-two-regions/) | [solution](t2/solutions/t2-arch-dr-two-regions/) |
| t2 | t2-gaps-jwt-middleware (pinned) | [t2-gaps-jwt-middleware.json](t2/t2-gaps-jwt-middleware.json) | [fixtures](t2/fixtures/t2-gaps-jwt-middleware/) | [hidden](t2/hidden/t2-gaps-jwt-middleware/) | [solution](t2/solutions/t2-gaps-jwt-middleware/) |
| t3 | t3-adr-db-engine | [t3-adr-db-engine.json](t3/t3-adr-db-engine.json) | [fixtures](t3/fixtures/t3-adr-db-engine/) | [hidden](t3/hidden/t3-adr-db-engine/) | [solution](t3/solutions/t3-adr-db-engine/) |
| t3 | t3-nfr-latency-budget | [t3-nfr-latency-budget.json](t3/t3-nfr-latency-budget.json) | [fixtures](t3/fixtures/t3-nfr-latency-budget/) | [hidden](t3/hidden/t3-nfr-latency-budget/) | [solution](t3/solutions/t3-nfr-latency-budget/) |
| t4 | t4-iam-bucket-policy-oac (pinned) | [t4-iam-bucket-policy-oac.json](t4/t4-iam-bucket-policy-oac.json) | [fixtures](t4/fixtures/t4-iam-bucket-policy-oac/) | [hidden](t4/hidden/t4-iam-bucket-policy-oac/) | [solution](t4/solutions/t4-iam-bucket-policy-oac/) |
| t4 | t4-iam-ci-deploy-role-twin (pinned) | [t4-iam-ci-deploy-role-twin.json](t4/t4-iam-ci-deploy-role-twin.json) | [fixtures](t4/fixtures/t4-iam-ci-deploy-role/) | [hidden](t4/hidden/t4-iam-ci-deploy-role-twin/) | [solution](t4/solutions/t4-iam-ci-deploy-role-twin/) |
| t5 | t5-qa-ledger-gaps (pinned) | [t5-qa-ledger-gaps.json](t5/t5-qa-ledger-gaps.json) | [fixtures](t5/fixtures/t5-qa-ledger-gaps/) | [hidden](t5/hidden/t5-qa-ledger-gaps/) | [solution](t5/solutions/t5-qa-ledger-gaps/) |
| t5 | t5-qa-scheduler-gaps (pinned) | [t5-qa-scheduler-gaps.json](t5/t5-qa-scheduler-gaps.json) | [fixtures](t5/fixtures/t5-qa-scheduler-gaps/) | [hidden](t5/hidden/t5-qa-scheduler-gaps/) | [solution](t5/solutions/t5-qa-scheduler-gaps/) |
| t6 | t6-req-data-export | [t6-req-data-export.json](t6/t6-req-data-export.json) | [fixtures](t6/fixtures/t6-req-data-export/) | [hidden](t6/hidden/t6-req-data-export/) | [solution](t6/solutions/t6-req-data-export/) |
| t6 | t6-req-field-inspections | [t6-req-field-inspections.json](t6/t6-req-field-inspections.json) | [fixtures](t6/fixtures/t6-req-field-inspections/) | [hidden](t6/hidden/t6-req-field-inspections/) | [solution](t6/solutions/t6-req-field-inspections/) |
| t7 | t7-pm-launch-cut (pinned) | [t7-pm-launch-cut.json](t7/t7-pm-launch-cut.json) | [fixtures](t7/fixtures/t7-pm-launch-cut/) | [hidden](t7/hidden/t7-pm-launch-cut/) | [solution](t7/solutions/t7-pm-launch-cut/) |
| t7 | t7-ship-train (pinned) | [t7-ship-train.json](t7/t7-ship-train.json) | [fixtures](t7/fixtures/t7-ship-train/) | [hidden](t7/hidden/t7-ship-train/) | [solution](t7/solutions/t7-ship-train/) |
| t8 | t8-inc-checkout-latency | [t8-inc-checkout-latency.json](t8/t8-inc-checkout-latency.json) | [fixtures](t8/fixtures/t8-inc-checkout-latency/) | [hidden](t8/hidden/t8-inc-checkout-latency/) | [solution](t8/solutions/t8-inc-checkout-latency/) |
| t8 | t8-neg-alert-threshold | [t8-neg-alert-threshold.json](t8/t8-neg-alert-threshold.json) | [fixtures](t8/fixtures/t8-neg-alert-threshold/) | [hidden](t8/hidden/t8-neg-alert-threshold/) | [solution](t8/solutions/t8-neg-alert-threshold/) |
| t9 | t9-impl-cart-summary | [t9-impl-cart-summary.json](t9/t9-impl-cart-summary.json) | [fixtures](t9/fixtures/t9-impl-cart-summary/) | [hidden](t9/hidden/t9-impl-cart-summary/) | [solution](t9/solutions/t9-impl-cart-summary/) |
| t10 | t10-arch-outbox | [t10-arch-outbox.json](t10/t10-arch-outbox.json) | [fixtures](t10/fixtures/t10-arch-outbox/) | [hidden](t10/hidden/t10-arch-outbox/) | [solution](t10/solutions/t10-arch-outbox/) |
| t11 | t11-resume-csv-export | [t11-resume-csv-export.json](t11/t11-resume-csv-export.json) | [fixtures](t11/fixtures/t11-resume-csv-export/) | [hidden](t11/hidden/t11-resume-csv-export/) | [solution](t11/solutions/t11-resume-csv-export/) |
| t12 | t12-spec-rate-limits | [t12-spec-rate-limits.json](t12/t12-spec-rate-limits.json) | [fixtures](t12/fixtures/t12-spec-rate-limits/) | [hidden](t12/hidden/t12-spec-rate-limits/) | [solution](t12/solutions/t12-spec-rate-limits/) |

21 task(s) in 12 batch(es), 0 batch(es) pending. For each one, record in the task's `review` block: read on (date), and whether it leaks the method, hides the answer in the fixture, or is ambiguous.
