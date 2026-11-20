# Notification delivery backlog incident

## Follow-up actions

- Change the consumer default to a finite retry limit and route non-retryable payload errors to a dead-letter topic. Owner: Messaging Platform.
- Add producer-consumer contract validation for the `recipient` type and run it before enabling a schema rollout. Owner: Notification API.
- Page on retry growth together with partition lag and oldest-message age, and add a dashboard panel for blocked offsets. Owner: SRE.
- Add a canary check that publishes a representative multi-device event and verifies acknowledgement before a full rollout. Owner: Release Engineering.

```json
{
 "actionItems": [
  {
   "owner": "Release Engineering",
   "text": "In short: Run a multi-device canary event and verify acknowledgement before full rollout."
  },
  {
   "owner": "SRE",
   "text": "In short: Alert on retry growth with partition lag and oldest-message age."
  },
  {
   "owner": "Notification API",
   "text": "In short: Add producer-consumer contract validation for recipient shape before schema rollout."
  },
  {
   "owner": "Messaging Platform",
   "text": "In short: Set a finite retry limit and send non-retryable payload errors to the dead-letter topic."
  }
 ],
 "impact": {
  "peakConsumerLag": 3185,
  "incidentDurationMinutes": 192,
  "longestDelayMinutes": 192,
  "delayedNotifications": 2865
 },
 "timeline": [
  {
   "event": "Producer schema 4.8 was enabled for delivery events.",
   "time": "2025-04-17T13:58:00Z"
  },
  {
   "event": "The API accepted the first affected event with a list recipient.",
   "time": "2025-04-17T14:07:00Z"
  },
  {
   "event": "Consumer A rejected the payload and began uncapped retries.",
   "time": "2025-04-17T14:07:00Z"
  },
  {
   "event": "The retry limit and dead-letter route were enabled.",
   "time": "2025-04-17T16:51:00Z"
  },
  {
   "event": "Consumer A restarted and routed the event to notify.events.dead.",
   "time": "2025-04-17T16:55:00Z"
  },
  {
   "event": "Partition 2 processing resumed with low lag.",
   "time": "2025-04-17T17:19:00Z"
  }
 ],
 "rootCause": {
  "evidence": [
   "logs/broker.log:1478",
   "config/consumer-config.yaml:17",
   "config/consumer-config.yaml:11",
   "logs/consumer-a.log:1842",
   "logs/consumer-a.log:1841",
   "logs/api.log:1473",
   "deploy/deploy-history.md:8"
  ],
  "summary": "In short: The schema 4.8 producer began sending recipient as an array while consumers required a string; the consumer's unlimited retry and disabled dead-letter route left the bad event at the head of partition 2."
 }
}
```

## Evidence and contributing conditions

The producer deploy record connects the new schema behavior to the first affected event. The consumer log identifies the incompatible field and shows that the event was not acknowledged. The deployed consumer configuration had `max_attempts: 0` and disabled dead-letter routing, so a payload-shape error had no terminal path. The broker log then records partition 2 blocked on the event. The disk alert resolved at 14:16 UTC, while the consumer lag and oldest-message age kept rising, which rules it out as the cause of the delivery delay.

## Timeline

- 2025-04-17T13:58:00Z: The delivery-event producer release enabled schema 4.8.
- 2025-04-17T14:07:00Z: The API accepted an event whose `recipient` value was a list.
- 2025-04-17T14:07:00Z: Consumer A reported a string-versus-array payload error and scheduled a retry without a cap.
- 2025-04-17T16:51:00Z: The consumer configuration was changed to cap attempts and enable dead-letter routing.
- 2025-04-17T16:55:00Z: Consumer A restarted, routed the bad event to the dead-letter topic, and resumed bounded processing.
- 2025-04-17T17:19:00Z: Partition 2 returned to low lag and zero oldest-message age.

## Customer impact

The metrics series reports 2,865 notifications that exceeded the support delay threshold. The longest observed delay was 192 minutes. The incident lasted 192 minutes from the first affected minute through recovery, and peak consumer lag was 3,185 queued events. Notifications on the other partitions continued to move, so these figures describe delayed delivery rather than a complete API outage.

## Summary

From 14:07 to 17:19 UTC, a delivery-event producer rollout sent `recipient` as a list for multi-device targets. The consumer contract still required a string. Consumer A rejected the event, did not acknowledge it, and retried it without a terminal attempt limit. Because the event stayed at the head of partition 2, later events in that partition waited behind it. The broker disk alert was a separate, short-lived capacity signal: disk usage returned below its threshold while the partition backlog continued to grow.

The configuration change at 16:51 UTC added a four-attempt limit and enabled the dead-letter topic. After consumer A loaded it and was restarted, the offending event was routed aside at 16:55 UTC and partition processing resumed. The metrics returned to ordinary lag and age at 17:19 UTC.
