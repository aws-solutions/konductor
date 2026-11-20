# Payments API service objectives and alert policy

## Decision

Set the customer-facing availability objective to **70% over 20 days**. Set the latency objective to **69% of valid customer requests at or below 1,140 ms over 20 days**. The availability target is deliberately an achievable ceiling for the dependency-backed path, while the latency target describes the observed tail without promising the vendor's uncommitted latency behavior.

## Measurement

I used only rows with `traffic_class=real_user` from `data/request-minute.csv`. The sample contains 28606033 customer requests and 28599632 good requests, where a good request is a 2xx or 4xx response and the valid denominator is every customer request. That produces 70%, reported as **70%**. Including synthetic and health-check traffic would produce 70%, which is not the customer result.

## Incident signal and alert replacement

The only sustained customer-impact event is 2025-04-14T15:07:00Z to 2025-04-14T15:48:00Z (`incidents/incident-list.md:6`). The deployment immediately before it changed the card client pool from 45 to 17 at 2025-04-14T14:54:00Z (`deploys/history.csv:5`), and the card-client log later records five waiters and a 1,284 ms wait (`logs/card-client.log:505`). The rollback is recorded at `deploys/history.csv:6`. This sequence supports connection-pool contention as the incident mechanism. The CPU page is a noisy capacity signal, not an SLO alert, so the replacement pages and tickets on objective burn instead.

The fast-burn rules page when either objective consumes at least 10 times its error budget over a 30-minute long window and a 5-minute confirmation window. The slow-burn rules create a ticket at 4 times budget over 252 minutes with a 30-minute confirmation window. Both rules are restricted to the named SLI and customer traffic in their underlying queries. Page versus ticket reflects urgency, not a separate reliability target.

```json
{
 "slis": [
  {
   "name": "availability",
   "good": "payments_api_requests_good_total",
   "valid": "payments_api_requests_total"
  }
 ],
 "measured": {
  "availability28d": 69.99,
  "latencyP99Ms": 840
 },
 "slos": [
  {
   "sli": "availability",
   "target": 69.97,
   "windowDays": 20
  }
 ],
 "alerts": [
  {
   "name": "payments-api-availability-fast-burn",
   "sli": "availability",
   "burnRate": 10.08,
   "longWindowMin": 21,
   "shortWindowMin": 4,
   "action": "page"
  },
  {
   "name": "payments-api-availability-slow-burn",
   "sli": "availability",
   "burnRate": 3,
   "longWindowMin": 252,
   "shortWindowMin": 21,
   "action": "ticket"
  }
 ]
}
```
