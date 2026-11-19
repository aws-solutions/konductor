# Incident summary: order reads during replica lag

On 2024-11-18, a regional network event caused the order read replicas to fall 90 seconds behind the primary for 14 minutes. Writes continued normally. A customer who placed an order saw the old list in the mobile app, then saw the order after the replica caught up.

The API's replica-lag alert fired at 60 seconds. The on-call changed the read pool to the primary for customer detail requests and left list requests on replicas. Error rate stayed below the availability threshold, and no order data was lost. The incident review recorded the read routing change as a useful emergency switch.

The event also exposed a dashboard gap: projection freshness and the age of the newest visible order were not on the standard service board. The team added those panels to the current service dashboard and documented the primary read switch in the runbook.
