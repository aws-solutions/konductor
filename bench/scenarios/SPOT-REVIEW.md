# Spot-review sample

The owner reads these tasks before any task of their batch is locked (plan section 8a). Drawn by `node bench/runner/bench.js scenarios spot-review --seed 20261119`:
per batch a shuffle with its own seed (the base seed plus the batch number) of the sorted task ids, dropped tasks left out, then the first 10%, rounded up, and at least one.
`spot-review.json` pins the samples the owner has already read and marks the batches that are not final yet. Redraw a batch only when it gains or loses tasks, and say so in the commit.

| batch | task | task file | fixture | hidden checks | reference |
| --- | --- | --- | --- | --- | --- |
| t1 | pending final batch | - | - | - | - |
| t2 | t2-arch-dr-two-regions (pinned) | [t2-arch-dr-two-regions.json](t2/t2-arch-dr-two-regions.json) | [fixtures](t2/fixtures/t2-arch-dr-two-regions/) | [hidden](t2/hidden/t2-arch-dr-two-regions/) | [solution](t2/solutions/t2-arch-dr-two-regions/) |
| t2 | t2-gaps-jwt-middleware (pinned) | [t2-gaps-jwt-middleware.json](t2/t2-gaps-jwt-middleware.json) | [fixtures](t2/fixtures/t2-gaps-jwt-middleware/) | [hidden](t2/hidden/t2-gaps-jwt-middleware/) | [solution](t2/solutions/t2-gaps-jwt-middleware/) |
| t3 | pending final batch | - | - | - | - |
| t4 | t4-iam-bucket-policy-oac (pinned) | [t4-iam-bucket-policy-oac.json](t4/t4-iam-bucket-policy-oac.json) | [fixtures](t4/fixtures/t4-iam-bucket-policy-oac/) | [hidden](t4/hidden/t4-iam-bucket-policy-oac/) | [solution](t4/solutions/t4-iam-bucket-policy-oac/) |
| t4 | t4-iam-ci-deploy-role-twin (pinned) | [t4-iam-ci-deploy-role-twin.json](t4/t4-iam-ci-deploy-role-twin.json) | [fixtures](t4/fixtures/t4-iam-ci-deploy-role/) | [hidden](t4/hidden/t4-iam-ci-deploy-role-twin/) | [solution](t4/solutions/t4-iam-ci-deploy-role-twin/) |
| t5 | t5-qa-ledger-gaps (pinned) | [t5-qa-ledger-gaps.json](t5/t5-qa-ledger-gaps.json) | [fixtures](t5/fixtures/t5-qa-ledger-gaps/) | [hidden](t5/hidden/t5-qa-ledger-gaps/) | [solution](t5/solutions/t5-qa-ledger-gaps/) |
| t5 | t5-qa-scheduler-gaps (pinned) | [t5-qa-scheduler-gaps.json](t5/t5-qa-scheduler-gaps.json) | [fixtures](t5/fixtures/t5-qa-scheduler-gaps/) | [hidden](t5/hidden/t5-qa-scheduler-gaps/) | [solution](t5/solutions/t5-qa-scheduler-gaps/) |
| t6 | t6-req-data-export | [t6-req-data-export.json](t6/t6-req-data-export.json) | [fixtures](t6/fixtures/t6-req-data-export/) | [hidden](t6/hidden/t6-req-data-export/) | [solution](t6/solutions/t6-req-data-export/) |
| t6 | t6-req-library-holds | [t6-req-library-holds.json](t6/t6-req-library-holds.json) | [fixtures](t6/fixtures/t6-req-library-holds/) | [hidden](t6/hidden/t6-req-library-holds/) | [solution](t6/solutions/t6-req-library-holds/) |
| t7 | t7-pm-launch-cut (pinned) | [t7-pm-launch-cut.json](t7/t7-pm-launch-cut.json) | [fixtures](t7/fixtures/t7-pm-launch-cut/) | [hidden](t7/hidden/t7-pm-launch-cut/) | [solution](t7/solutions/t7-pm-launch-cut/) |
| t7 | t7-ship-train (pinned) | [t7-ship-train.json](t7/t7-ship-train.json) | [fixtures](t7/fixtures/t7-ship-train/) | [hidden](t7/hidden/t7-ship-train/) | [solution](t7/solutions/t7-ship-train/) |
| t8 | pending final batch | - | - | - | - |
| t9 | pending final batch | - | - | - | - |
| t10 | pending final batch | - | - | - | - |
| t11 | pending final batch | - | - | - | - |
| t12 | pending final batch | - | - | - | - |

10 task(s) in 5 batch(es), 7 batch(es) pending. For each one, record in the task's `review` block: read on (date), and whether it leaks the method, hides the answer in the fixture, or is ambiguous.
