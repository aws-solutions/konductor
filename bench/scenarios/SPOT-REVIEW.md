# Spot-review sample

The owner reads these tasks before any task of their batch is locked (plan section 8a). Drawn by `node bench/runner/bench.js scenarios spot-review --seed 20261119`:
per batch a seeded shuffle of the sorted task ids, then the first 10%, rounded up, and at least one. Redraw only when a batch gains or loses tasks, and say so in the commit.

| batch | task | task file | fixture | hidden checks | reference |
| --- | --- | --- | --- | --- | --- |
| t1 | t1-bug-event-listeners | [t1-bug-event-listeners.json](t1/t1-bug-event-listeners.json) | [fixtures](t1/fixtures/t1-bug-event-listeners/) | [hidden](t1/hidden/t1-bug-event-listeners/) | [solution](t1/solutions/t1-bug-event-listeners/) |
| t1 | t1-impl-money-split | [t1-impl-money-split.json](t1/t1-impl-money-split.json) | [fixtures](t1/fixtures/t1-impl-money-split/) | [hidden](t1/hidden/t1-impl-money-split/) | [solution](t1/solutions/t1-impl-money-split/) |
| t2 | t2-arch-dr-two-regions | [t2-arch-dr-two-regions.json](t2/t2-arch-dr-two-regions.json) | [fixtures](t2/fixtures/t2-arch-dr-two-regions/) | [hidden](t2/hidden/t2-arch-dr-two-regions/) | [solution](t2/solutions/t2-arch-dr-two-regions/) |
| t2 | t2-gaps-jwt-middleware | [t2-gaps-jwt-middleware.json](t2/t2-gaps-jwt-middleware.json) | [fixtures](t2/fixtures/t2-gaps-jwt-middleware/) | [hidden](t2/hidden/t2-gaps-jwt-middleware/) | [solution](t2/solutions/t2-gaps-jwt-middleware/) |
| t3 | t3-arch-notification-pipeline | [t3-arch-notification-pipeline.json](t3/t3-arch-notification-pipeline.json) | [fixtures](t3/fixtures/t3-arch-notification-pipeline/) | [hidden](t3/hidden/t3-arch-notification-pipeline/) | [solution](t3/solutions/t3-arch-notification-pipeline/) |
| t3 | t3-db-tenant-isolation | [t3-db-tenant-isolation.json](t3/t3-db-tenant-isolation.json) | [fixtures](t3/fixtures/t3-db-tenant-isolation/) | [hidden](t3/hidden/t3-db-tenant-isolation/) | [solution](t3/solutions/t3-db-tenant-isolation/) |
| t3 | t3-pm-feature-scope | [t3-pm-feature-scope.json](t3/t3-pm-feature-scope.json) | [fixtures](t3/fixtures/t3-pm-feature-scope/) | [hidden](t3/hidden/t3-pm-feature-scope/) | [solution](t3/solutions/t3-pm-feature-scope/) |
| t4 | t4-iam-bucket-policy-oac | [t4-iam-bucket-policy-oac.json](t4/t4-iam-bucket-policy-oac.json) | [fixtures](t4/fixtures/t4-iam-bucket-policy-oac/) | [hidden](t4/hidden/t4-iam-bucket-policy-oac/) | [solution](t4/solutions/t4-iam-bucket-policy-oac/) |
| t4 | t4-iam-ci-deploy-role-twin | [t4-iam-ci-deploy-role-twin.json](t4/t4-iam-ci-deploy-role-twin.json) | [fixtures](t4/fixtures/t4-iam-ci-deploy-role/) | [hidden](t4/hidden/t4-iam-ci-deploy-role-twin/) | [solution](t4/solutions/t4-iam-ci-deploy-role-twin/) |
| t5 | t5-qa-ledger-gaps | [t5-qa-ledger-gaps.json](t5/t5-qa-ledger-gaps.json) | [fixtures](t5/fixtures/t5-qa-ledger-gaps/) | [hidden](t5/hidden/t5-qa-ledger-gaps/) | [solution](t5/solutions/t5-qa-ledger-gaps/) |
| t5 | t5-qa-scheduler-gaps | [t5-qa-scheduler-gaps.json](t5/t5-qa-scheduler-gaps.json) | [fixtures](t5/fixtures/t5-qa-scheduler-gaps/) | [hidden](t5/hidden/t5-qa-scheduler-gaps/) | [solution](t5/solutions/t5-qa-scheduler-gaps/) |
| t6 | t6-idea-feature-bets | [t6-idea-feature-bets.json](t6/t6-idea-feature-bets.json) | [fixtures](t6/fixtures/t6-idea-feature-bets/) | [hidden](t6/hidden/t6-idea-feature-bets/) | [solution](t6/solutions/t6-idea-feature-bets/) |
| t6 | t6-req-clinic-reminders | [t6-req-clinic-reminders.json](t6/t6-req-clinic-reminders.json) | [fixtures](t6/fixtures/t6-req-clinic-reminders/) | [hidden](t6/hidden/t6-req-clinic-reminders/) | [solution](t6/solutions/t6-req-clinic-reminders/) |
| t7 | t7-pm-launch-cut | [t7-pm-launch-cut.json](t7/t7-pm-launch-cut.json) | [fixtures](t7/fixtures/t7-pm-launch-cut/) | [hidden](t7/hidden/t7-pm-launch-cut/) | [solution](t7/solutions/t7-pm-launch-cut/) |
| t7 | t7-ship-train | [t7-ship-train.json](t7/t7-ship-train.json) | [fixtures](t7/fixtures/t7-ship-train/) | [hidden](t7/hidden/t7-ship-train/) | [solution](t7/solutions/t7-ship-train/) |
| t8 | t8-inc-queue-backlog | [t8-inc-queue-backlog.json](t8/t8-inc-queue-backlog.json) | [fixtures](t8/fixtures/t8-inc-queue-backlog/) | [hidden](t8/hidden/t8-inc-queue-backlog/) | [solution](t8/solutions/t8-inc-queue-backlog/) |
| t8 | t8-neg-config-question | [t8-neg-config-question.json](t8/t8-neg-config-question.json) | [fixtures](t8/fixtures/t8-neg-config-question/) | [hidden](t8/hidden/t8-neg-config-question/) | [solution](t8/solutions/t8-neg-config-question/) |

17 task(s) in 8 batch(es). For each one, record in the task's `review` block: read on (date), and whether it leaks the method, hides the answer in the fixture, or is ambiguous.
