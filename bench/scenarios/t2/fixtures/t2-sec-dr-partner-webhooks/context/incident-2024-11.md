# Partner endpoint incident summary

_Incident date: 2024-11-06. Report approved by Reliability and Trust on 2024-11-19._

At 14:12 UTC, Partner Operations received reports that order notifications for two tenants were arriving at a destination the tenants did not recognize. The affected connection belonged to partner `p-fern`. The partner's DNS provider account had been accessed by an unknown party earlier that morning, and the webhook hostname resolved to an address controlled by that party for 47 minutes.

The platform sent 18,430 event requests during that interval. The requests returned HTTP 200 responses. The partner reported the destination change at 15:03 UTC. The on-call revoked the connection credential at 15:16 UTC and the partner restored its DNS record at 15:27 UTC. A review of platform logs found the connection configuration, request status, and destination hostname for the affected deliveries. The body content was not retained in the incident report.

No other partner connection was associated with the reported hostname during the incident window. The affected tenants were notified by Partner Operations. The incident had no reported impact on the order system or internal billing consumers.

Timeline:

- 13:25 UTC: partner DNS provider account login recorded.
- 14:12 UTC: first successful delivery to the changed resolution.
- 14:19 UTC: first affected tenant's support ticket opened.
- 15:03 UTC: Partner Operations linked the tickets to the endpoint.
- 15:16 UTC: credential revoked.
- 15:27 UTC: partner DNS record restored.
- 16:40 UTC: delivery records exported for the incident review.
