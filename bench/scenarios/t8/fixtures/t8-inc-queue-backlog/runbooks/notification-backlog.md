# Notification backlog response

Check the API enqueue rate, group lag, oldest message age, retry volume, and broker disk separately. Confirm whether all partitions are moving before restarting a worker. Capture the event ID and partition from the consumer log before replaying anything.

For a worker restart, preserve the current logs and record the loaded configuration. If a payload cannot be handled safely, send it to the configured dead-letter destination rather than replaying it indefinitely. A replay should be limited to a small time range and watched for changes in lag.
