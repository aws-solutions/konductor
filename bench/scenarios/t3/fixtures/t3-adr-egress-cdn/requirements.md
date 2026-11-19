# Delivery path requirements

The video team is moving 180 TB of clip traffic per calendar month from the origin to viewers. The delivery path must keep the measured p95 time from request to the first playable bytes at or below 800 ms. This is a viewer-facing requirement rather than a target for the origin's internal write path.

Finance has approved a recurring delivery budget of no more than USD 9,500 per month. The estimate should include the egress charges and the option-specific delivery or request charge described by the price sheet. Storage capacity, encoding, and one-time migration work are outside this decision.

| Decision concern | Production requirement | Evidence |
| --- | ---: | --- |
| Monthly clip data delivered | 180 TB | `traffic.json` |
| p95 request-to-first-byte | 800 ms maximum | `service-levels.json` and `performance.csv` |
| Recurring delivery spend | USD 9,500 maximum | `service-levels.json` and `price-sheet.json` |

The architect should select a delivery option that meets the production requirements and explain why it is preferable to the alternatives.
