# Notes

I read the README and the main files. Summary below.

```json
{
 "rootCause": {
  "summary": "An expired EU gateway-to-auth mTLS client certificate triggered the regional login outage when its not-after time passed at 2025-02-14T11:00:00Z.",
  "evidence": [
   "certs/certificate-inventory.csv:2",
   "logs/gateway-eu.log:672"
  ]
 },
 "timeline": [
  {
   "time": "2025-02-14T10:49:00Z",
   "event": "The rel-8421 auth deployment started in both regions."
  },
  {
   "time": "2025-02-14T11:00:01Z",
   "event": "The EU edge returned the first 502 from an upstream TLS handshake failure."
  },
  {
   "time": "2025-02-14T11:04:00Z",
   "event": "The EU login success-rate alert fired."
  },
  {
   "time": "2025-02-14T11:26:00Z",
   "event": "The auth release rollback completed, but EU failures continued with no change."
  }
 ],
 "impact": {
  "duration_minutes": 28,
  "failed_login_attempts": 12226,
  "peak_tls_handshake_errors": 314
 },
 "actionItems": [
  {
   "text": "Renew and deploy each regional gateway-to-auth mTLS certificate before its not-after time, then verify a successful handshake.",
   "owner": "Devon, platform security"
  },
  {
   "text": "Add per-region certificate-expiry monitoring and alert on renewal failures at least 21 days before expiration.",
   "owner": "Mila, platform operations"
  }
 ]
}
```
