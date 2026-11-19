# Card Network service note

Issued 2025-03-20 by the card-network service desk. The published monthly availability SLO for the authorization endpoint is **99.95%**, measured on valid authorization calls. Scheduled maintenance is included in the service's monthly accounting window.

The card network does not guarantee a higher availability objective to clients, even when a client uses retries. Retry traffic is charged as calls and can increase contention during an incident.

For client-side performance, the network normally returns within 450 ms, but this note makes no latency commitment. Escalation reference: CN-4821.
