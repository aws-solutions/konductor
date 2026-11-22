# Incident summary: delayed account changes

On 2024-11-18, a database maintenance job increased the outbox queue age for 47 minutes. Settings writes returned successfully, but the Messaging preference view continued using the previous value until the worker caught up. The largest observed gap between a successful write and sender visibility was 52 minutes.

The incident review added queue-age monitoring, a replay command scoped by account ID, and a dashboard panel for event age. It also recorded that the sender must keep its last known version and ignore an older replay. The incident did not change the product's propagation target.

During recovery, the team paused nonessential account events and allowed billing and account-activity notices to use their previous defaults. The operational runbook says to page the Notifications Platform owner at 10 minutes of queue age and to stop a rollout when the 60-second visibility target is missed for two consecutive five-minute windows.