# Notes

I read the README and the main files. Summary below.

```json
{
 "rootCause": {
  "summary": "The schema 4.8 producer began sending recipient as an array while consumers required a string; the consumer's unlimited retry and disabled dead-letter route left the bad event at the head of partition 2.",
  "evidence": [
   "deploy/deploy-history.md:8",
   "logs/api.log:1473",
   "logs/consumer-a.log:1841",
   "logs/consumer-a.log:1842"
  ]
 },
 "timeline": [
  {
   "time": "2025-04-17T13:58:00Z",
   "event": "Producer schema 4.8 was enabled for delivery events."
  },
  {
   "time": "2025-04-17T14:07:00Z",
   "event": "The API accepted the first affected event with a list recipient."
  },
  {
   "time": "2025-04-17T14:07:00Z",
   "event": "Consumer A rejected the payload and began uncapped retries."
  }
 ],
 "impact": {
  "delayedNotifications": 2005,
  "longestDelayMinutes": 134,
  "incidentDurationMinutes": 134,
  "peakConsumerLag": 2230
 },
 "actionItems": [
  {
   "text": "Set a finite retry limit and send non-retryable payload errors to the dead-letter topic.",
   "owner": "Messaging Platform"
  },
  {
   "text": "Add producer-consumer contract validation for recipient shape before schema rollout.",
   "owner": "Notification API"
  }
 ]
}
```
