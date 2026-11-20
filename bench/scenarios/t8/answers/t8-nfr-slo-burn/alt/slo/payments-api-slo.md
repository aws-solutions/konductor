# Payments API service objectives and alert policy

## Incident signal and alert replacement

The only sustained customer-impact event is 2025-04-14T15:07:00Z to 2025-04-14T15:48:00Z (`incidents/incident-list.md:6`). The deployment immediately before it changed the card client pool from 64 to 24 at 2025-04-14T14:54:00Z (`deploys/history.csv:5`), and the card-client log later records five waiters and a 1,405 ms wait (`logs/card-client.log:505`). The rollback is recorded at `deploys/history.csv:6`. This sequence supports connection-pool contention as the incident mechanism. The CPU page is a noisy capacity signal, not an SLO alert, so the replacement pages and tickets on objective burn instead.

The fast-burn rules page when either objective consumes at least 14.4 times its error budget over a 30-minute long window and a 5-minute confirmation window. The slow-burn rules create a ticket at 4 times budget over 360 minutes with a 30-minute confirmation window. Both rules are restricted to the named SLI and customer traffic in their underlying queries. Page versus ticket reflects urgency, not a separate reliability target.

The JSON summary below is the machine-readable contract for these decisions. Times in supporting evidence use ISO 8601 UTC, and cited log evidence uses `path:line`, with paths relative to this folder and one-based line numbers.

```json
{
 "alerts": [
  {
   "action": "ticket",
   "shortWindowMin": 30,
   "longWindowMin": 360,
   "burnRate": 4,
   "sli": "latency_p99",
   "name": "payments-api-latency-slow-burn"
  },
  {
   "action": "page",
   "shortWindowMin": 5,
   "longWindowMin": 30,
   "burnRate": 14.4,
   "sli": "latency_p99",
   "name": "payments-api-latency-fast-burn"
  },
  {
   "action": "ticket",
   "shortWindowMin": 30,
   "longWindowMin": 360,
   "burnRate": 4,
   "sli": "availability",
   "name": "payments-api-availability-slow-burn"
  },
  {
   "action": "page",
   "shortWindowMin": 5,
   "longWindowMin": 30,
   "burnRate": 14.4,
   "sli": "availability",
   "name": "payments-api-availability-fast-burn"
  }
 ],
 "slos": [
  {
   "windowDays": 28,
   "target": 99,
   "sli": "latency_p99"
  },
  {
   "windowDays": 28,
   "target": 99.95,
   "sli": "availability"
  }
 ],
 "measured": {
  "latencyP99Ms": 1200,
  "availability28d": 99.98
 },
 "slis": [
  {
   "valid": "payments_api_request_duration_ms_count",
   "good": "payments_api_request_duration_ms_under_1200_total",
   "name": "latency_p99"
  },
  {
   "valid": "payments_api_requests_total",
   "good": "payments_api_requests_good_total",
   "name": "availability"
  }
 ]
}
```

## Measurement

I used only rows with `traffic_class=real_user` from `data/request-minute.csv`. The sample contains 40,865,762 customer requests and 40,856,617 good requests, where a good request is a 2xx or 4xx response and the valid denominator is every customer request. That produces 99.97762185%, reported as **99.98%**. Including synthetic and health-check traffic would produce 99.994838%, which is not the customer result.

For latency, the cumulative customer histogram reaches 98.63% at 800 ms and 99.41% at 1,200 ms. The 28-day p99 is therefore **1,200 ms** using the bucket-edge method documented with the export. The objective leaves a small but measurable margin over the observed p99 rather than turning a probe result into a customer promise.

## Decision

Set the customer-facing availability objective to **99.95% over 28 days**. Set the latency objective to **99% of valid customer requests at or below 1,200 ms over 28 days**. The availability target is deliberately an achievable ceiling for the dependency-backed path, while the latency target describes the observed tail without promising the vendor's uncommitted latency behavior.

The product request for five nines is a useful direction, but it is not the objective for this service window. The vendor note publishes a 99.95% authorization availability SLO, so a higher end-to-end promise would claim reliability the API cannot control.
