# Production release runbook

1. Confirm the change record, compatible database migration, and current fleet health.
2. Stop accepting new sessions on the selected hosts. Wait for the drain alarm to clear or record the remaining sessions.
3. Start the new binary on the first exposure set. Check connection success, websocket close rate, room-operation error rate, upstream pool wait, and presence lag.
4. Hold the exposure for enough traffic to cover normal room churn. Continue only if all release alerts remain quiet.
5. If the health signal fails, stop exposure, preserve the UTC timestamp, and restore the last known-good binary or setting.
6. Record every exposure change and the final session drain in the change record.

The on-call engineer may stop a release without waiting for a second approver.
