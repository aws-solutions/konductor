# orders-api SLOs

| SLI | Target (30 days) | Measured from |
| --- | --- | --- |
| Availability (non-5xx share of requests) | 99.5 % | `http_5xx_rate` |
| Checkout latency p99 | under 800 ms for 99 % of minutes | `p99_latency_ms` |
| Payment success | 99.0 % of authorisations not declined for a reason on our side | soft declines minus issuer, funds and expired-card reasons |

Issuer soft declines, insufficient funds and expired cards are the customer's bank or card, not us, and do not count
against the payment SLO. Every other soft decline does.

Error budget status (2026-11-20 09:00 UTC): availability 71 % left, latency 64 % left, payment 58 % left.
