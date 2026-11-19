# Notification metric catalogue

The CSV uses one UTC row per minute. `enqueue_rate` is events per minute. `consumer_lag` is queued events. `processed_per_second` is events per second across the consumer group. `retries` is retry attempts recorded in that minute. `dead_letter_count` is events routed to a dead-letter topic. `broker_disk_pct` is broker disk usage as a percent. `oldest_message_age_sec` is the age of the oldest queued event in seconds. `delayed_notifications_total` is the cumulative count of notifications whose delivery exceeded the support delay threshold.
