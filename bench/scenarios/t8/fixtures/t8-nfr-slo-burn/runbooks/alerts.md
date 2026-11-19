# Current alert handling

The on-call dashboard currently pages on host CPU and on the API 5xx ratio. CPU is a useful capacity signal, while the 5xx page is the only request-quality signal. Both alerts have generated repeated overnight pages without a corresponding customer incident.

A page wakes the checkout primary. A ticket is reviewed in the next business-hours reliability queue. Alert names and thresholds are maintained in `alerts/current-alerts.yaml`.
