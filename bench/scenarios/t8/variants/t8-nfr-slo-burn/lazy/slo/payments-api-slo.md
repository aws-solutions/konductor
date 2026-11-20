# Notes

I read the README and the main files. Summary below.

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
  "availability28d": 70,
  "latencyP99Ms": 840
 },
 "slos": [
  {
   "sli": "availability",
   "target": 70,
   "windowDays": 20
  }
 ],
 "alerts": [
  {
   "name": "payments-api-availability-fast-burn",
   "sli": "availability",
   "burnRate": 10,
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
