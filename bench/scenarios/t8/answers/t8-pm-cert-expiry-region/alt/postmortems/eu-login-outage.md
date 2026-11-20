# EU Login Outage Postmortem

**Date:** 2025-02-14 UTC  
**Service:** Atlas Login  
**Severity:** SEV-1 for the EU login path

## Structured review record

```json
{
 "actionItems": [
  {
   "owner": "Priya, reliability engineering",
   "text": "In short: Run a quarterly regional login failover exercise and record the recovery time."
  },
  {
   "owner": "Mila, platform operations",
   "text": "In short: Add per-region certificate-expiry monitoring and alert on renewal failures at least 21 days before expiration."
  },
  {
   "owner": "Devon, platform security",
   "text": "In short: Renew and deploy each regional gateway-to-auth mTLS certificate before its not-after time, then verify a successful handshake."
  }
 ],
 "impact": {
  "peak_tls_handshake_errors": 448,
  "failed_login_attempts": 17465,
  "duration_minutes": 40
 },
 "timeline": [
  {
   "event": "The rel-8421 auth deployment started in both regions.",
   "time": "2025-02-14T10:49:00Z"
  },
  {
   "event": "The EU edge returned the first 502 from an upstream TLS handshake failure.",
   "time": "2025-02-14T11:00:01Z"
  },
  {
   "event": "The EU login success-rate alert fired.",
   "time": "2025-02-14T11:04:00Z"
  },
  {
   "event": "The auth release rollback completed, but EU failures continued with no change.",
   "time": "2025-02-14T11:26:00Z"
  },
  {
   "event": "Mitigation routed EU login traffic through the healthy US auth pool.",
   "time": "2025-02-14T11:40:00Z"
  },
  {
   "event": "The EU success-rate alert recovered after the routing change.",
   "time": "2025-02-14T11:42:00Z"
  },
  {
   "event": "A replacement EU gateway credential was staged.",
   "time": "2025-02-14T12:05:00Z"
  }
 ],
 "rootCause": {
  "evidence": [
   "logs/auth-eu.log:670",
   "logs/gateway-eu.log:672",
   "certs/certificate-inventory.csv:2"
  ],
  "summary": "In short: An expired EU gateway-to-auth mTLS client certificate triggered the regional login outage when its not-after time passed at 2025-02-14T11:00:00Z."
 }
}
```

## Corrective actions

- Replace the expired regional gateway-to-auth certificate and validate a successful mTLS handshake before its not-after time. **Owner:** Devon, platform security. **Due:** 2025-02-21.
- Add a per-region expiry alert at least 21 days before not-after and page when the renewal job does not produce a new inventory record. **Owner:** Mila, platform operations. **Due:** 2025-02-28.
- Exercise regional login failover quarterly and record the recovery time. **Owner:** Priya, reliability engineering. **Due:** 2025-03-07.

## Root cause and contributing conditions

The gateway-to-auth mTLS certificate for `eu-west-1` expired at 11:00 UTC. The EU gateway then rejected every attempted handshake with `auth-eu`, producing the edge 502s and the low login success rate. The US gateway had a different certificate with a later not-after time, which explains why the second region stayed healthy.

The release was a temporal red herring. It ran in both regions, the rollback did not change the EU symptom, and the certificate and handshake records point to the regional credential instead.

Evidence:

- `certs/certificate-inventory.csv:2` records serial `A7E4-91C2` in `eu-west-1` with `not_after` `2025-02-14T11:00:00Z`.
- `logs/gateway-eu.log:672` records the failed mTLS handshake and `x509: certificate has expired` for that serial.
- `logs/auth-eu.log:670` records the auth service rejecting the gateway because the client certificate was expired.
- `logs/edge-eu.log:1334` records the first customer-facing 502.
- `incident/channel-export.md:22` records that the rollback completed without changing the EU failures.
- `incident/channel-export.md:31` records the routing mitigation, followed by recovery at `incident/channel-export.md:34`.

## Timeline

- **2025-02-14T10:49:00Z:** `rel-8421` auth deployment started in both regions.
- **2025-02-14T11:00:01Z:** The EU edge returned the first 502 caused by an upstream TLS handshake failure.
- **2025-02-14T11:04:00Z:** The EU login success-rate alert fired.
- **2025-02-14T11:26:00Z:** The auth release rollback completed in both regions; EU failures continued.
- **2025-02-14T11:40:00Z:** EU login traffic was routed through the healthy US auth pool.
- **2025-02-14T11:42:00Z:** The EU success-rate alert recovered after the routing change.
- **2025-02-14T12:05:00Z:** A replacement EU gateway credential was staged.

## Customer impact

- 40 minutes of degraded EU login service, from 11:00 to 11:40 UTC.
- 17,465 failed login attempts during that interval.
- One region was affected. US login service remained available.
- The EU metrics reached 448 TLS handshake errors in one minute at the peak.

## Summary

From 11:00 to 11:40 UTC, login requests entering through `eu-west-1` failed while the `us-east-1` path remained healthy. The gateway could not establish mutual TLS with `auth-eu` because the EU gateway client certificate reached its not-after time. The regional inventory shows the EU certificate ending at 11:00 UTC, and the gateway and auth logs record the corresponding expired-certificate rejection. The auth release deployed at 10:49 UTC was rolled back in both regions, but EU failures continued, so it was not the cause.

We routed EU login traffic through the healthy US auth pool at 11:40 UTC. The EU success-rate alert recovered at 11:42 UTC. A replacement EU credential was staged later, and the normal EU handshake check was green at 12:11 UTC.
