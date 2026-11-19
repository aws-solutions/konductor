# Cluster migration packet

This packet supports a production database cutover decision. Read the current production figures together with the operating notes and price sheet. The files intentionally use different views of the same service: the traffic file describes the network, while the requirements file describes what the service can tolerate.

A lab rehearsal from the retired staging environment recorded a 2.4 TB data set and a 300 MB/s daytime allowance. Those figures are **superseded by the current production inventory and throttle sheet** in this packet and must not be used for the decision.

The migration is scheduled for the Sunday maintenance calendar in `change-calendar.md`. The target cluster is already approved for use; this packet is about selecting the cutover approach and recording the decision.
