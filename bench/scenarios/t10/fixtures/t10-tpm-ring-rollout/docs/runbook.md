# Receipt runbook

Check the service health endpoint before investigating a delivery alert. A renderer error includes the receipt id and a stable error code; do not paste customer data into the incident channel.

For a bad deploy, stop new traffic at the deployment controller, inspect the last ten minutes of renderer and delivery metrics, and use the previous artifact. The on-call engineer owns the first response and asks the fulfillment owner to confirm downstream delivery before reopening traffic.

Configuration changes are reviewed during business hours. A release that changes the output envelope requires the partner owners to acknowledge the compatibility window.
