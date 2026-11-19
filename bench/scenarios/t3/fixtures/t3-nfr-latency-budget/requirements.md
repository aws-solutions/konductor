# Checkout non-functional requirements

**Owner:** Commerce platform architecture  
**Environment:** production checkout, revision 2025-02

A checkout request enters the edge gateway, is authenticated, obtains a price and stock reservation, and then charges the payment provider. The production objective is an end-to-end **p99 of no more than 600 ms** for this complete request. The service must continue to accept the **1,200 requests/second peak** recorded in the traffic profile.

| Requirement | Production limit | Interpretation |
| --- | ---: | --- |
| End-to-end checkout p99 | 600 ms maximum | Includes gateway through payment |
| Peak throughput | 1,200 requests/second minimum capacity | One regional checkout deployment |
| Recurring spend | 1,000 USD/month maximum | Includes the existing checkout platform |
| Checkout request body | 256 KB maximum | Before compression, including headers |
| Recovery point objective | 60 seconds maximum | Lost committed checkout state |
| Recovery time objective | 5 minutes maximum | Return to accepting checkout traffic |

A sample from the old staging exercise used **900 requests/second**. That figure is superseded by the 1,200 requests/second production profile and must not drive this review. The monthly cap is a hard cap, not a target to exceed temporarily.

The review should state how the chosen design handles the serial and independent portions of the request. It should also account for the payment hop rather than treating payment as an asynchronous follow-up.