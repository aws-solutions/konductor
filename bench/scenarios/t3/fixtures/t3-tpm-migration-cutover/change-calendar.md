# Change calendar and operating notes

The reserved production change starts at 02:00 local time on Sunday. Customer traffic remains enabled during preparation. The operator may pause acknowledged writes only for the final handoff, and the maintenance coordinator will measure that pause from the first write rejection until the target accepts writes. Every handoff step in `migration-model.json` runs inside that pause, so the user-visible downtime is the sum of the steps. A big-bang copy moves the whole production data set at the off-hours replication rate while writes are paused.

The cutover record must state the expected recovery point, the p95 latency effect, and the recurring monthly charge. The rollback checkpoint is the source cluster's last confirmed consistent position. A rehearsal may use a smaller data set, but rehearsal duration is not evidence that the production copy will finish inside the reserved window.
